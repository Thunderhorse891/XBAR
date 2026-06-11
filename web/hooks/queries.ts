'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, type DocumentFilters, type OcrAssignment } from '@/lib/api';
import type { BarnBranding, BarnMember, CalendarEvent, HealthRecord, Horse } from '@/lib/types';

export function useHorses() {
  return useQuery({ queryKey: ['horses'], queryFn: api.listHorses });
}

export function useHorse(id: string) {
  return useQuery({ queryKey: ['horses', id], queryFn: () => api.getHorse(id) });
}

export function useCreateHorse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.createHorse,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['horses'] }),
  });
}

export function useUpdateHorse(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Horse>) => api.updateHorse(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['horses'] }),
  });
}

export function useHealth(horseId: string) {
  return useQuery({ queryKey: ['health', horseId], queryFn: () => api.listHealth(horseId) });
}

export function useAddReminder(horseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: HealthRecord['kind']; label: string; nextDue: string }) => api.addReminder(horseId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['health', horseId] }),
  });
}

export function useTimeline(horseId: string) {
  return useInfiniteQuery({
    queryKey: ['timeline', horseId],
    queryFn: ({ pageParam }) => api.listTimeline(horseId, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => (lastPage.hasMore ? pages.length : undefined),
  });
}

export function useOwnership(horseId: string) {
  return useQuery({ queryKey: ['ownership', horseId], queryFn: () => api.listOwnership(horseId) });
}

export function useDocuments(filters: DocumentFilters) {
  return useQuery({
    queryKey: ['documents', filters],
    queryFn: () => api.listDocuments(filters),
    placeholderData: (previous) => previous,
  });
}

export function useSaveOcrAssignments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assignments: OcrAssignment[]) => api.saveOcrAssignments(assignments),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      queryClient.invalidateQueries({ queryKey: ['horses'] });
    },
  });
}

export function useCalendarEvents() {
  return useQuery({ queryKey: ['events'], queryFn: api.listEvents });
}

export function useCreateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CalendarEvent, 'id'>) => api.createEvent(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['events'] }),
  });
}

export function useSalePackets(horseId?: string) {
  return useQuery({ queryKey: ['packets', horseId ?? 'all'], queryFn: () => api.listSalePackets(horseId) });
}

export function useCreateSalePacket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.createSalePacket,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['packets'] }),
  });
}

export function useNotifications() {
  return useQuery({ queryKey: ['notifications'], queryFn: api.listNotifications, refetchInterval: 60_000 });
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.markNotificationsRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useSubscription() {
  return useQuery({ queryKey: ['subscription'], queryFn: api.getSubscription });
}

export function useInvoices() {
  return useQuery({ queryKey: ['invoices'], queryFn: api.listInvoices });
}

export function useBarnMembers() {
  return useQuery({ queryKey: ['barn-members'], queryFn: api.listBarnMembers });
}

export function useInviteBarnMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; role: BarnMember['role'] }) => api.inviteBarnMember(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['barn-members'] }),
  });
}

export function useActivity() {
  return useQuery({ queryKey: ['activity'], queryFn: api.listActivity });
}

export function useBranding() {
  return useQuery({ queryKey: ['branding'], queryFn: api.getBranding });
}

export function useUpdateBranding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<BarnBranding>) => api.updateBranding(patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['branding'] }),
  });
}
