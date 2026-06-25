import { create } from 'zustand';
import type { Room, RoomMember, MemberStatus } from '@/types';
import { rooms as roomsApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
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
  joinRoom: (code: string, displayName?: string, skills?: string) => Promise<RoomMember>;
  createRoom: (name: string, brief: string, language: string[], maxTeammates: number, skills?: string) => Promise<Room>;
  reset: () => void;
}

const initial = {
  room: null,
  members: [],
  isLoading: false,
  error: null,
  myMemberId: null,
};

const MEMBER_KEY = (code: string) => `mosaic_member_${code.toUpperCase()}`;

export const useRoomStore = create<RoomState>()((set, get) => ({
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
      // Recover "me" so identity survives reloads / direct navigation.
      // Authenticated users are matched by their user id; guests have no JWT,
      // so we restore the member id persisted at join time.
      let myMemberId = get().myMemberId;
      if (!myMemberId) {
        const authUser = useAuthStore.getState().user;
        if (authUser) {
          const mine = members.find((m) => m.userId === authUser.id);
          if (mine) myMemberId = mine.id;
        }
      }
      if (!myMemberId) {
        const stored = localStorage.getItem(MEMBER_KEY(code));
        if (stored && members.some((m) => m.id === stored)) myMemberId = stored;
      }
      set({ room: data.room, members, myMemberId });
    } catch (err) {
      set({ error: (err as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  joinRoom: async (code, displayName, skills) => {
    set({ isLoading: true, error: null });
    try {
      const { data: member } = await roomsApi.join(code, displayName, skills);
      // Persist so guests keep their identity across reloads.
      localStorage.setItem(MEMBER_KEY(code), member.id);
      set({ myMemberId: member.id });
      return member;
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    } finally {
      set({ isLoading: false });
    }
  },

  createRoom: async (name, brief, language, maxTeammates, skills) => {
    set({ isLoading: true, error: null });
    try {
      const { data: room } = await roomsApi.create({ name, brief, language, maxTeammates, skills });
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
