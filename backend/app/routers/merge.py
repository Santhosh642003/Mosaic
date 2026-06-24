"""Merge endpoints: trigger, result, download ZIP, push to GitHub."""

import io
import json
import logging
import zipfile

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth_utils import get_current_user
from app.database import get_db
from app.models import Merge, Room, Task, User
from app.schemas import GitHubPushRequest, GitHubPushResponse, MergeResponse

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/{code}/merge", response_model=MergeResponse, status_code=202)
async def trigger_merge(
    code: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MergeResponse:
    """Kick off the async merge process for a room (lead only)."""
    result = await db.execute(select(Room).where(Room.code == code.upper()))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    if room.lead_id != user.id:
        raise HTTPException(status_code=403, detail="Only the room lead can trigger a merge")
    if room.status not in ("coding", "waiting"):
        raise HTTPException(status_code=409, detail="Room is not in a mergeable state")

    room.status = "merging"
    await db.flush()

    # Kick off merge in background so we can return 202 immediately
    from app.services.merger import run_merge
    background_tasks.add_task(run_merge, room.id, code.upper())

    return MergeResponse(room_id=room.id, status="merging", merged_files={})


@router.get("/{code}/merge/result", response_model=MergeResponse)
async def get_merge_result(
    code: str,
    db: AsyncSession = Depends(get_db),
) -> MergeResponse:
    """Poll for the latest merge result."""
    result = await db.execute(select(Room).where(Room.code == code.upper()))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    merge_result = await db.execute(
        select(Merge).where(Merge.room_id == room.id).order_by(Merge.created_at.desc())
    )
    merge = merge_result.scalar_one_or_none()

    if not merge:
        return MergeResponse(room_id=room.id, status=room.status, merged_files={})

    return MergeResponse(
        room_id=room.id,
        status="complete",
        merged_files=merge.merged_files or {},
        diff_report=merge.diff_report,
        conflicts=merge.conflicts,
    )


@router.get("/{code}/merge/download")
async def download_merge(
    code: str,
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Download the merged codebase as a ZIP archive."""
    result = await db.execute(select(Room).where(Room.code == code.upper()))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    merge_result = await db.execute(
        select(Merge).where(Merge.room_id == room.id).order_by(Merge.created_at.desc())
    )
    merge = merge_result.scalar_one_or_none()
    if not merge or not merge.merged_files:
        raise HTTPException(status_code=404, detail="No merge result available")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path, content in (merge.merged_files or {}).items():
            zf.writestr(path, content if isinstance(content, str) else json.dumps(content))
    buf.seek(0)

    filename = f"mosaic-{code.upper()}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{code}/merge/push-github", response_model=GitHubPushResponse)
async def push_to_github(
    code: str,
    body: GitHubPushRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> GitHubPushResponse:
    """Push merged codebase to the user's GitHub repository."""
    if not user.github_token:
        raise HTTPException(
            status_code=400,
            detail="No GitHub token. Connect your GitHub account via Settings first.",
        )

    result = await db.execute(select(Room).where(Room.code == code.upper()))
    room = result.scalar_one_or_none()
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    merge_result = await db.execute(
        select(Merge).where(Merge.room_id == room.id).order_by(Merge.created_at.desc())
    )
    merge = merge_result.scalar_one_or_none()
    if not merge or not merge.merged_files:
        raise HTTPException(status_code=404, detail="No merge result available")

    # Resolve "repo" -> "owner/repo" using the authenticated GitHub user
    repo = body.repo
    gh_headers = {
        "Authorization": f"Bearer {user.github_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    async with httpx.AsyncClient(timeout=30) as client:
        if "/" not in repo:
            me_resp = await client.get("https://api.github.com/user", headers=gh_headers)
            if me_resp.status_code != 200:
                raise HTTPException(status_code=401, detail="GitHub token invalid or expired")
            login = me_resp.json().get("login")
            repo = f"{login}/{repo}"

        owner, repo_name = repo.split("/", 1)

        # Ensure branch exists — get default branch SHA first
        repo_resp = await client.get(f"https://api.github.com/repos/{repo}", headers=gh_headers)
        if repo_resp.status_code == 404:
            raise HTTPException(status_code=404, detail=f"GitHub repo '{repo}' not found or no access")
        if repo_resp.status_code != 200:
            raise HTTPException(status_code=502, detail="GitHub API error fetching repo")

        repo_data = repo_resp.json()
        default_branch = repo_data.get("default_branch", "main")

        # Get the SHA of the default branch HEAD
        ref_resp = await client.get(
            f"https://api.github.com/repos/{repo}/git/ref/heads/{default_branch}",
            headers=gh_headers,
        )
        if ref_resp.status_code == 404:
            # Empty repo — we'll need to create initial commit differently
            base_sha = None
        elif ref_resp.status_code == 200:
            base_sha = ref_resp.json()["object"]["sha"]
        else:
            raise HTTPException(status_code=502, detail="GitHub API error fetching branch ref")

        # Build the tree of blobs
        blobs: list[dict] = []
        merged: dict[str, str] = merge.merged_files or {}

        for path, content in merged.items():
            if not isinstance(content, str):
                content = json.dumps(content, indent=2)
            blob_resp = await client.post(
                f"https://api.github.com/repos/{repo}/git/blobs",
                headers=gh_headers,
                json={"content": content, "encoding": "utf-8"},
            )
            if blob_resp.status_code not in (200, 201):
                raise HTTPException(status_code=502, detail=f"Failed to create blob for {path}")
            blobs.append({
                "path": path,
                "mode": "100644",
                "type": "blob",
                "sha": blob_resp.json()["sha"],
            })

        # Create tree
        tree_payload: dict = {"tree": blobs}
        if base_sha:
            # Get the tree SHA of the base commit
            commit_resp = await client.get(
                f"https://api.github.com/repos/{repo}/git/commits/{base_sha}",
                headers=gh_headers,
            )
            base_tree_sha = commit_resp.json()["tree"]["sha"]
            tree_payload["base_tree"] = base_tree_sha

        tree_resp = await client.post(
            f"https://api.github.com/repos/{repo}/git/trees",
            headers=gh_headers,
            json=tree_payload,
        )
        if tree_resp.status_code not in (200, 201):
            raise HTTPException(status_code=502, detail="Failed to create git tree on GitHub")
        tree_sha = tree_resp.json()["sha"]

        # Create commit
        commit_payload: dict = {
            "message": body.commit_message,
            "tree": tree_sha,
        }
        if base_sha:
            commit_payload["parents"] = [base_sha]

        commit_create_resp = await client.post(
            f"https://api.github.com/repos/{repo}/git/commits",
            headers=gh_headers,
            json=commit_payload,
        )
        if commit_create_resp.status_code not in (200, 201):
            raise HTTPException(status_code=502, detail="Failed to create commit on GitHub")
        new_commit_sha = commit_create_resp.json()["sha"]

        # Create or update branch ref
        branch_ref = f"refs/heads/{body.branch}"
        patch_resp = await client.patch(
            f"https://api.github.com/repos/{repo}/git/refs/heads/{body.branch}",
            headers=gh_headers,
            json={"sha": new_commit_sha, "force": True},
        )
        if patch_resp.status_code == 422:
            # Branch doesn't exist — create it
            create_ref_resp = await client.post(
                f"https://api.github.com/repos/{repo}/git/refs",
                headers=gh_headers,
                json={"ref": branch_ref, "sha": new_commit_sha},
            )
            if create_ref_resp.status_code not in (200, 201):
                raise HTTPException(status_code=502, detail="Failed to create branch on GitHub")

    pr_url = f"https://github.com/{repo}/compare/{body.branch}?expand=1"
    return GitHubPushResponse(
        repo=repo,
        branch=body.branch,
        url=f"https://github.com/{repo}/tree/{body.branch}",
        files_pushed=len(blobs),
    )
