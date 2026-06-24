"""Auth endpoints: register, login, GitHub OAuth, current user."""

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from urllib.parse import quote

from app.auth_utils import (
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from app.config import settings
from app.database import get_db
from app.models import User
from app.schemas import (
    LoginRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Register ─────────────────────────────────────────────────────────────────

@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    """Create a new account and return a JWT."""
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
        display_name=body.display_name,
    )
    db.add(user)
    await db.flush()  # get the auto-generated ID

    token = create_access_token(user.id)
    return TokenResponse(access_token=token)


# ── Login ─────────────────────────────────────────────────────────────────────

@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    """Validate credentials and return a JWT."""
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if not user or not user.hashed_password:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    return TokenResponse(access_token=create_access_token(user.id))


# ── Me ────────────────────────────────────────────────────────────────────────

@router.get("/me", response_model=UserResponse)
async def me(user: User = Depends(get_current_user)) -> UserResponse:
    """Return the currently authenticated user."""
    return UserResponse.from_user(user)


# ── GitHub OAuth ──────────────────────────────────────────────────────────────

@router.get("/github")
async def github_redirect() -> dict:
    """Return the GitHub OAuth authorization URL."""
    if not settings.github_client_id:
        raise HTTPException(status_code=501, detail="GitHub OAuth not configured")

    url = (
        f"https://github.com/login/oauth/authorize"
        f"?client_id={settings.github_client_id}"
        f"&redirect_uri={settings.github_redirect_uri}"
        f"&scope=user:email,repo"
    )
    return {"url": url}


def _oauth_redirect(*, token: str | None = None, error: str | None = None) -> RedirectResponse:
    """Redirect the browser back to the frontend OAuth callback page."""
    base = settings.frontend_url.rstrip("/")
    if token:
        return RedirectResponse(url=f"{base}/auth/callback?token={quote(token)}")
    return RedirectResponse(url=f"{base}/auth/callback?error={quote(error or 'GitHub sign-in failed')}")


@router.get("/github/callback")
async def github_callback(code: str, db: AsyncSession = Depends(get_db)) -> RedirectResponse:
    """Exchange GitHub OAuth code for a Mosaic JWT, then redirect to the frontend."""
    if not settings.github_client_id:
        return _oauth_redirect(error="GitHub OAuth not configured")

    try:
        async with httpx.AsyncClient() as client:
            # Exchange code for access token
            token_resp = await client.post(
                "https://github.com/login/oauth/access_token",
                json={
                    "client_id": settings.github_client_id,
                    "client_secret": settings.github_client_secret,
                    "code": code,
                    "redirect_uri": settings.github_redirect_uri,
                },
                headers={"Accept": "application/json"},
                timeout=10,
            )
            token_data = token_resp.json()
            gh_token = token_data.get("access_token")
            if not gh_token:
                return _oauth_redirect(error="GitHub sign-in failed")

            # Fetch user info
            user_resp = await client.get(
                "https://api.github.com/user",
                headers={"Authorization": f"Bearer {gh_token}", "Accept": "application/json"},
                timeout=10,
            )
            gh_user = user_resp.json()

            # Fetch primary email if not public
            email = gh_user.get("email")
            if not email:
                emails_resp = await client.get(
                    "https://api.github.com/user/emails",
                    headers={"Authorization": f"Bearer {gh_token}"},
                    timeout=10,
                )
                emails = emails_resp.json()
                primary = next((e for e in emails if e.get("primary") and e.get("verified")), None)
                email = primary["email"] if primary else None
    except httpx.HTTPError:
        logger.exception("GitHub OAuth network error")
        return _oauth_redirect(error="Could not reach GitHub. Try again.")

    if not email:
        return _oauth_redirect(error="Could not retrieve email from GitHub")

    github_id = str(gh_user["id"])

    # Upsert user
    result = await db.execute(select(User).where(User.github_id == github_id))
    user = result.scalar_one_or_none()

    if user:
        user.github_token = gh_token
    else:
        # Check if email exists (account merge)
        result2 = await db.execute(select(User).where(User.email == email))
        user = result2.scalar_one_or_none()
        if user:
            user.github_id = github_id
            user.github_token = gh_token
            user.avatar = gh_user.get("avatar_url")
        else:
            user = User(
                email=email,
                display_name=gh_user.get("name") or gh_user.get("login", "GitHub User"),
                github_id=github_id,
                github_token=gh_token,
                avatar=gh_user.get("avatar_url"),
            )
            db.add(user)
            await db.flush()

    return _oauth_redirect(token=create_access_token(user.id))


# ── Forgot password ───────────────────────────────────────────────────────────

@router.post("/forgot-password", status_code=202)
async def forgot_password(body: dict, db: AsyncSession = Depends(get_db)) -> dict:
    """Send a password reset email (stub — integrate with email provider)."""
    email = body.get("email", "")
    result = await db.execute(select(User).where(User.email == email))
    # Always return 202 to prevent email enumeration
    _ = result.scalar_one_or_none()
    logger.info("password reset requested for %s", email)
    return {"detail": "If that email exists, a reset link has been sent."}
