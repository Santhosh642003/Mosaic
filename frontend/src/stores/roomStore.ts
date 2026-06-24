import { create } from 'zustand';
import type { Room, RoomMember, MemberStatus } from '@/types';
import { rooms as roomsApi } from '@/lib/api';
import { initials as toInitials, avatarColor } from '@/lib/utils';

interface RoomState {
  room: Room | null;
  members: RoomMember[];
  isLoading: boolean;
  error: string | null;
  myMemberId: string | null;

  setRoom: (room: Room) => void;
  setMembers: (members: RoomMember[]) => void;
  updateMemberStatus: (memberId: string, status: MemberStatus) => void;
  addMember: (member: RoomMember) => void;
  setMyMemberId: (id: string) => void;
  fetchRoom: (code: string) => Promise<void>;
  joinRoom: (code: string, displayName?: string) => Promise<RoomMember>;
  createRoom: (name: string, brief: string, language: string[], maxTeammates: number) => Promise<Room>;
  reset: () => void;
}

const initial = {
  room: null,
  members: [],
  isLoading: false,
  error: null,
  myMemberId: null,
};

export const useRoomStore = create<RoomState>()((set, _get) => ({
  ...initial,

  setRoom: (room) => set({ room }),
  setMembers: (members) => set({ members }),

  updateMemberStatus: (memberId, status) =>
    set((s) => ({
      members: s.members.map((m) => (m.id === memberId ? { ...m, status } : m)),
    })),

  addMember: (member) =>
    set((s) => ({
      members: s.members.some((m) => m.id === member.id)
        ? s.members
        : [...s.members, member],
    })),

  setMyMemberId: (id) => set({ myMemberId: id }),

  fetchRoom: async (code) => {
    set({ isLoading: true, error: null });
    try {
      const { data } = await roomsApi.state(code);
      const members: RoomMember[] = data.members.map((m) => ({
        ...m,
        initials: m.initials ?? toInitials(m.displayName),
        avatarColor: m.avatarColor ?? avatarColor(m.displayName),
      }));
      set({ room: data.room, members });
    } catch (err) {
      set({ error: (err as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  joinRoom: async (code, displayName) => {
    set({ isLoading: true, error: null });
    try {
      const { data: member } = await roomsApi.join(code, displayName);
      set({ myMemberId: member.id });
      return member;
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  createRoom: async (name, brief, language, maxTeammates) => {
    set({ isLoading: true, error: null });
    try {
      const { data: room } = await roomsApi.create({ name, brief, language, maxTeammates });
      set({ room });
      return room;
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  reset: () => set(initial),
}));

export const useRoom = () => useRoomStore((s) => s.room);
export const useMembers = () => useRoomStore((s) => s.members);
