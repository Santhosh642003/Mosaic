import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Check, ChevronRight, Send, Zap, Shield, TestTube, BookOpen, Clock } from 'lucide-react';
import { MosaicLogo } from '@/components/shared/MosaicLogo';
import { Avatar } from '@/components/shared/Avatar';
import { Button } from '@/components/ui/button';
import { useTaskStore, useMyTask } from '@/stores/taskStore';
import { useRoomStore } from '@/stores/roomStore';
import { getSocket, connectSocket, emit } from '@/lib/socket';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/types';

const MonacoEditor = lazy(() =>
  import('@monaco-editor/react').then((m) => ({ default: m.default }))
);

const MOCK_CODE = `from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
import uuid

from .models import Message
from .schemas import MessageIn, MessageOut
from .dependencies import get_db, verify_token

router = APIRouter(prefix="/messages", tags=["messages"])


@router.post("/", response_model=MessageOut)
async def save_message(
    msg: MessageIn,
    room_id: str,
    user_id: str = Depends(verify_token),
    db: AsyncSession = Depends(get_db),
) -> MessageOut:
    """Save a chat message and return the persisted record."""
    record = Message(
        id=str(uuid.uuid4()),
        room_id=room_id,
        user_id=user_id,
        content=msg.content,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return MessageOut.from_orm(record)


@router.get("/{room_id}", response_model=list[MessageOut])
async def get_messages(
    room_id: str,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
) -> list[MessageOut]:
    """Fetch paginated message history for a room."""
    result = await db.execute(
        select(Message)
        .where(Message.room_id == room_id)
        .order_by(Message.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return [MessageOut.from_orm(r) for r in result.scalars()]
`;

const MOCK_FILES = [
  { name: 'messages.py', lang: 'python', active: true },
  { name: 'models.py',   lang: 'python', active: false },
  { name: 'schemas.py',  lang: 'python', active: false },
];

const MOCK_TEAMMATES = [
  { name: 'Maya Chen',   initials: 'MC', task: 'Auth service',    status: 'done'    as const, color: '#4F8EF7' },
  { name: 'Sofia Reyes', initials: 'SR', task: 'WebSocket gw.',   status: 'coding'  as const, color: '#A371F7' },
  { name: 'Devon Park',  initials: 'DP', task: 'React frontend',  status: 'blocked' as const, color: '#D29922' },
];

const QUICK_ACTIONS = [
  { icon: Zap,      label: 'Write boilerplate' },
  { icon: Shield,   label: 'Add error handling' },
  { icon: TestTube, label: 'Write tests' },
  { icon: BookOpen, label: 'Explain code' },
];

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: '0',
    role: 'assistant',
    content: "Hi! I'm your AI pair programmer scoped to the **Message API** task.\n\nI know your interface contracts: `save_message()` must accept `room_id` and `MessageIn`, and `GET /messages/{room_id}` must return a paginated list. I can see what Auth (T1) exposes and what WebSocket (T3) depends on.\n\nWhat do you want to build first?",
    timestamp: new Date().toISOString(),
  },
];

function MobileGuard() {
  return (
    <div className="ide-guard min-h-screen flex-col items-center justify-center p-8 text-center">
      <MosaicLogo size="lg" className="justify-center mb-8" />
      <h2 className="text-xl font-bold mb-3">Open on desktop to code</h2>
      <p className="text-ms-fg2 text-sm max-w-xs leading-relaxed">
        The Mosaic coding session requires a wide screen. Open this URL on a laptop or desktop to continue.
      </p>
    </div>
  );
}

export default function CodingSession() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const myTask = useMyTask();
  const { chatMessages, addChatMessage, appendChatChunk, finalizeChatStream, isChatStreaming, setIsChatStreaming } = useTaskStore();
  const { members } = useRoomStore();

  // Derive files from real task, fall back to mock for demo
  const taskFiles = myTask?.files?.length
    ? myTask.files.map((name) => ({ name, lang: name.endsWith('.py') ? 'python' : name.endsWith('.ts') || name.endsWith('.tsx') ? 'typescript' : 'javascript', active: false }))
    : MOCK_FILES;

  const [activeFile, setActiveFile] = useState(taskFiles[0]?.name ?? 'messages.py');
  const [editorCode, setEditorCode] = useState<Record<string, string>>(myTask?.code ?? {});
  const [isBlocked, setIsBlocked] = useState(false);
  const [input, setInput] = useState('');
  const [timer, setTimer] = useState(8 * 3600 - 42 * 60);
  const [isMarking, setIsMarking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const currentCode = editorCode[activeFile] ?? (myTask ? '' : MOCK_CODE);
  const displayMessages = chatMessages.length > 0 ? chatMessages : INITIAL_MESSAGES;

  useEffect(() => {
    const t = setInterval(() => setTimer((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayMessages]);

  useEffect(() => {
    connectSocket();
    const socket = getSocket();
    socket.on('ai_response_stream', ({ chunk, done }) => {
      if (done) {
        finalizeChatStream();
      } else {
        appendChatChunk(chunk);
      }
    });
    return () => { socket.off('ai_response_stream'); };
  }, [appendChatChunk, finalizeChatStream]);

  const formatTimer = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const sendMessage = (text: string) => {
    if (!text.trim() || isChatStreaming) return;
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };
    addChatMessage(userMsg);
    setInput('');
    setIsChatStreaming(true);

    // Placeholder streaming response (real: emit ai_prompt via socket)
    const aiMsg: ChatMessage = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
      streaming: true,
      timestamp: new Date().toISOString(),
    };
    addChatMessage(aiMsg);

    emit('ai_prompt', {
      taskId: myTask?.id,
      prompt: text,
      contextCode: JSON.stringify({ task: myTask }),
    });

    // Local fallback simulation
    const response = `Here's how I'd approach that:\n\n\`\`\`python\n# Updated implementation\nasync def save_message(\n    msg: MessageIn,\n    room_id: str,\n    user_id: str = Depends(verify_token),\n    db: AsyncSession = Depends(get_db),\n) -> MessageOut:\n    # Check for duplicates first\n    existing = await db.execute(\n        select(Message).where(\n            Message.room_id == room_id,\n            Message.content == msg.content,\n            Message.user_id == user_id,\n        ).limit(1)\n    )\n    if existing.scalar():\n        raise HTTPException(status_code=409, detail="Duplicate message")\n    record = Message(...)\n    ...\n\`\`\`\n\nThis adds idempotency protection while keeping the contract intact.`;

    let i = 0;
    const interval = setInterval(() => {
      if (i >= response.length) {
        clearInterval(interval);
        finalizeChatStream();
        return;
      }
      appendChatChunk(response[i]);
      i++;
    }, 12);
  };

  const handleMarkDone = async () => {
    setIsMarking(true);
    const submitCode = Object.keys(editorCode).length > 0 ? editorCode : { [activeFile]: currentCode };
    emit('submit_task', { taskId: myTask?.id ?? '', code: submitCode });
    setTimeout(() => navigate(`/rooms/${code}/merge`), 600);
  };

  const teammates = members.length > 0
    ? members.filter((m) => m.id !== 'myId').map((m) => ({ name: m.displayName, initials: m.initials, task: 'Task', status: m.status, color: '#4F8EF7' }))
    : MOCK_TEAMMATES;

  return (
    <>
      <MobileGuard />
      <div className="ide-layout h-screen flex flex-col bg-ms-deep overflow-hidden">
        {/* Top bar */}
        <div className="flex-none h-11 flex items-center px-4 gap-4 border-b border-ms-subtle bg-ms-surface">
          <MosaicLogo size="sm" />
          <span className="text-ms-fg3 text-sm">|</span>
          <span className="text-sm font-semibold">PingChat</span>
          <span className="text-[10px] font-mono text-ms-fg3">#4K7P2X</span>
          <span className="text-ms-fg3">·</span>
          <span className="text-sm text-ms-blue font-semibold">Message API</span>

          {/* Teammate pills */}
          <div className="flex items-center gap-2 ml-4">
            {teammates.map((tm) => (
              <div key={tm.name} className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-semibold"
                style={{ color: tm.status === 'done' ? '#A371F7' : tm.status === 'coding' ? '#3FB950' : '#D29922',
                  borderColor: tm.status === 'done' ? '#A371F730' : tm.status === 'coding' ? '#3FB95030' : '#D2992230',
                  background: tm.status === 'done' ? '#A371F710' : tm.status === 'coding' ? '#3FB95010' : '#D2992210' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: tm.status === 'done' ? '#A371F7' : tm.status === 'coding' ? '#3FB950' : '#D29922' }} />
                {tm.name.split(' ')[0]}
              </div>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-1.5 font-mono text-sm text-ms-fg3">
              <Clock size={12} />
              {formatTimer(timer)}
            </div>
            <Button
              size="sm"
              className="bg-ms-green hover:bg-[#56d364] text-white"
              loading={isMarking}
              onClick={handleMarkDone}
            >
              <Check size={14} /> Mark as Done
            </Button>
          </div>
        </div>

        {/* Blocked banner */}
        {isBlocked && (
          <div className="flex-none flex items-center gap-3 px-4 py-2 bg-ms-amber/10 border-b border-ms-amber/30 text-ms-amber text-sm">
            <AlertTriangle size={14} />
            <span className="font-semibold">You marked yourself as blocked.</span>
            <span className="text-ms-amber/80">Team has been notified. Post details in the team chat.</span>
            <button onClick={() => setIsBlocked(false)} className="ml-auto text-ms-amber/60 hover:text-ms-amber text-lg leading-none">×</button>
          </div>
        )}

        {/* 3-column layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left panel */}
          <div className="w-56 flex-none border-r border-ms-subtle bg-ms-surface flex flex-col overflow-y-auto">
            {/* Task card */}
            <div className="p-3 border-b border-ms-subtle">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="w-2 h-2 rounded-full" style={{ background: myTask?.color ?? '#3FB950' }} />
                <span className="text-[10px] font-bold uppercase tracking-wider text-ms-fg3">Your task</span>
              </div>
              <div className="text-sm font-bold text-ms-fg">{myTask?.name ?? 'Task'}</div>
              <div className="text-[11px] text-ms-fg3 mt-1 leading-relaxed">
                {myTask?.description ?? 'Code your assigned task.'}
              </div>
            </div>

            {/* File tree */}
            <div className="p-2 border-b border-ms-subtle flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-ms-fg3 px-1 mb-2">Files</p>
              {MOCK_FILES.map((f) => (
                <button
                  key={f.name}
                  onClick={() => setActiveFile(f.name)}
                  className={cn(
                    'w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-[12px] font-mono transition-colors',
                    activeFile === f.name
                      ? 'bg-ms-blue/20 text-ms-blue'
                      : 'text-ms-fg3 hover:text-ms-fg hover:bg-ms-raised'
                  )}
                >
                  <ChevronRight size={10} className={activeFile === f.name ? 'rotate-90' : ''} />
                  {f.name}
                </button>
              ))}
            </div>

            {/* Contracts */}
            <div className="p-2 border-b border-ms-subtle">
              <p className="text-[10px] font-bold uppercase tracking-wider text-ms-fg3 px-1 mb-2">Exposes</p>
              <div className="space-y-1">
                <div className="text-[10px] font-mono px-2 py-1 rounded bg-ms-deep border border-ms-subtle text-ms-green">
                  POST /messages
                </div>
                <div className="text-[10px] font-mono px-2 py-1 rounded bg-ms-deep border border-ms-subtle text-ms-green">
                  GET /messages/{'{room_id}'}
                </div>
              </div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-ms-fg3 px-1 mt-3 mb-2">Needs (T1)</p>
              <div className="text-[10px] font-mono px-2 py-1 rounded bg-ms-deep border border-ms-subtle text-ms-blue">
                verify_token(token)
              </div>
            </div>

            {/* Teammate status */}
            <div className="p-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-ms-fg3 px-1 mb-2">Team</p>
              {teammates.map((tm) => (
                <div key={tm.name} className="flex items-center gap-2 px-1 py-1.5">
                  <Avatar name={tm.name} size="xs" color={tm.color} status={tm.status} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-semibold text-ms-fg truncate">{tm.name.split(' ')[0]}</div>
                    <div className="text-[10px] text-ms-fg3 truncate">{tm.task}</div>
                  </div>
                </div>
              ))}
              <button
                onClick={() => { setIsBlocked((b) => !b); emit('update_status', { status: isBlocked ? 'coding' : 'blocked' }); }}
                className={cn(
                  'w-full mt-2 py-1.5 rounded text-[11px] font-semibold border transition-colors',
                  isBlocked
                    ? 'border-ms-amber/40 bg-ms-amber/10 text-ms-amber'
                    : 'border-ms-border text-ms-fg3 hover:text-ms-amber hover:border-ms-amber/40 hover:bg-ms-amber/5'
                )}
              >
                {isBlocked ? '✓ Blocked (undo)' : 'I\'m Blocked'}
              </button>
            </div>
          </div>

          {/* Center: Monaco editor */}
          <div className="flex-1 flex flex-col min-w-0 bg-ms-deep">
            {/* Tab bar */}
            <div className="flex-none flex items-center border-b border-ms-subtle bg-ms-surface h-9">
              {taskFiles.map((f) => (
                <button
                  key={f.name}
                  onClick={() => setActiveFile(f.name)}
                  className={cn(
                    'px-4 h-full text-xs font-mono border-r border-ms-subtle transition-colors',
                    activeFile === f.name
                      ? 'bg-ms-deep text-ms-fg border-t-2 border-t-ms-blue'
                      : 'text-ms-fg3 hover:text-ms-fg hover:bg-ms-raised'
                  )}
                >
                  {f.name}
                </button>
              ))}
            </div>

            {/* Editor */}
            <div className="flex-1 overflow-hidden">
              <Suspense
                fallback={
                  <div className="h-full flex items-center justify-center">
                    <div className="text-ms-fg3 text-sm font-mono animate-ms-pulse">Loading editor…</div>
                  </div>
                }
              >
                <MonacoEditor
                  height="100%"
                  language={taskFiles.find((f) => f.name === activeFile)?.lang ?? 'python'}
                  value={currentCode}
                  onChange={(val) => setEditorCode((prev) => ({ ...prev, [activeFile]: val ?? '' }))}
                  theme="vs-dark"
                  options={{
                    fontSize: 13,
                    fontFamily: '"JetBrains Mono", Menlo, monospace',
                    fontLigatures: true,
                    lineNumbers: 'on',
                    minimap: { enabled: true },
                    scrollBeyondLastLine: false,
                    renderWhitespace: 'none',
                    wordWrap: 'on',
                    automaticLayout: true,
                    padding: { top: 12 },
                    cursorStyle: 'line',
                    cursorBlinking: 'blink',
                  }}
                />
              </Suspense>
            </div>

            {/* Status bar */}
            <div className="flex-none h-6 flex items-center px-4 gap-4 bg-ms-blue text-white text-[10px] font-mono">
              <span>Python</span>
              <span>·</span>
              <span>UTF-8</span>
              <span>·</span>
              <span>LF</span>
              <span className="ml-auto">Ln 24, Col 1</span>
            </div>
          </div>

          {/* Right: AI chat */}
          <div className="w-72 flex-none border-l border-ms-subtle bg-ms-surface flex flex-col">
            {/* Chat header */}
            <div className="flex-none px-4 py-3 border-b border-ms-subtle">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded bg-ms-purple/20 flex items-center justify-center">
                  <span className="text-ms-purple text-[10px] font-bold">AI</span>
                </div>
                <span className="text-xs font-bold">Qwen2.5-Coder</span>
                <span className="ml-auto text-[10px] text-ms-green font-semibold">● Live</span>
              </div>
              <div className="mt-1.5 text-[10px] text-ms-fg3">
                Context: Message API task + all interface contracts
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {displayMessages.map((msg) => (
                <div key={msg.id} className={cn('flex gap-2', msg.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
                  {msg.role === 'assistant' && (
                    <div className="w-5 h-5 rounded bg-ms-purple/20 flex items-center justify-center flex-none mt-0.5">
                      <span className="text-ms-purple text-[8px] font-bold">AI</span>
                    </div>
                  )}
                  <div className={cn(
                    'max-w-[85%] rounded-xl p-3 text-xs leading-relaxed',
                    msg.role === 'user'
                      ? 'bg-ms-blue/20 text-ms-fg border border-ms-blue/20'
                      : 'bg-ms-raised border border-ms-border text-ms-fg2'
                  )}>
                    {msg.content.split('```').map((part, i) => {
                      if (i % 2 === 1) {
                        const [lang, ...lines] = part.split('\n');
                        return (
                          <div key={i} className="my-2">
                            <div className="flex items-center justify-between px-2 py-1 bg-ms-deep rounded-t border border-ms-border">
                              <span className="text-[10px] text-ms-fg3">{lang || 'code'}</span>
                              <button className="text-[10px] text-ms-blue hover:underline">Insert</button>
                            </div>
                            <pre className="bg-ms-deep border border-t-0 border-ms-border rounded-b p-2 overflow-x-auto text-ms-green font-mono text-[11px]">
                              {lines.join('\n')}
                            </pre>
                          </div>
                        );
                      }
                      return <span key={i}>{part.replace(/\*\*(.*?)\*\*/g, '$1')}</span>;
                    })}
                    {msg.streaming && (
                      <span className="inline-block w-1.5 h-3 bg-ms-purple ml-0.5 animate-ms-pulse" />
                    )}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            {/* Quick actions */}
            <div className="flex-none px-3 py-2 border-t border-ms-subtle">
              <div className="flex flex-wrap gap-1.5 mb-2">
                {QUICK_ACTIONS.map((a) => (
                  <button
                    key={a.label}
                    onClick={() => { setInput(a.label); }}
                    className="flex items-center gap-1 px-2 py-1 rounded border border-ms-border bg-ms-raised text-[10px] text-ms-fg3 hover:text-ms-fg hover:border-ms-border transition-colors"
                  >
                    <a.icon size={10} />
                    {a.label}
                  </button>
                ))}
              </div>
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
                  placeholder="Ask AI to write, edit, explain, debug…"
                  rows={2}
                  className="flex-1 bg-ms-raised border border-ms-border rounded-lg px-3 py-2 text-xs text-ms-fg placeholder:text-ms-fg3 resize-none focus:outline-none focus:ring-1 focus:ring-ms-blue"
                />
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim() || isChatStreaming}
                  className="w-8 h-8 rounded-lg bg-ms-blue disabled:opacity-40 flex items-center justify-center flex-none hover:bg-[#6B9EF8] transition-colors"
                >
                  <Send size={13} className="text-white" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
