import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import {
  CalendarDays, Check, ChevronRight, CircleAlert, Clock3, FileUp, ListChecks,
  Loader2, MessageCircle, PencilLine, Plus, Search, Send, Trash2, Users, X,
} from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

type TaskStatus = 'new' | 'in_progress' | 'review' | 'done' | 'returned';
type TaskPriority = 'normal' | 'important' | 'urgent';
type TaskView = 'list' | 'kanban' | 'calendar' | 'table';

interface Agent { id: string; name: string; user_id: string | null; avatar_url?: string | null; }
interface Department { id: string; name: string; manager_id: string | null; color: string; is_active: boolean; }
interface DepartmentMember { department_id: string; agent_id: string; is_primary: boolean; }
interface Lead { id: string; full_name: string | null; phone: string | null; }
interface TaskRow {
  id: string; clinic_id: string; department_id: string | null; creator_agent_id: string | null;
  assignee_id: string | null; lead_id: string | null; title: string; description: string;
  status: TaskStatus; priority: TaskPriority; due_at: string | null; requires_review: boolean;
  accepted_at: string | null; started_at: string | null; completed_at: string | null;
  created_at: string; updated_at: string;
}
interface ChecklistItem { id: string; task_id: string; text: string; position: number; is_done: boolean; completed_by: string | null; }
interface TaskComment { id: string; task_id: string; author_id: string | null; body: string; created_at: string; }
interface TaskEvent { id: string; task_id: string; actor_id: string | null; type: string; payload: Record<string, string>; created_at: string; }
interface TaskAttachment { id: string; task_id: string; file_name: string; file_path: string; created_at: string; }

const statusMeta: Record<TaskStatus, { label: string; color: string }> = {
  new: { label: 'Новая', color: '#64748B' },
  in_progress: { label: 'В работе', color: '#2563EB' },
  review: { label: 'На проверке', color: '#A16207' },
  returned: { label: 'Возвращена', color: '#C2410C' },
  done: { label: 'Выполнена', color: '#15803D' },
};

const priorityMeta: Record<TaskPriority, { label: string; color: string }> = {
  normal: { label: 'Обычная', color: '#64748B' },
  important: { label: 'Важная', color: '#D97706' },
  urgent: { label: 'Срочная', color: '#DC2626' },
};

const managerRoles = new Set(['owner', 'manager']);

function formatDate(value?: string | null, includeTime = true) {
  if (!value) return 'Без срока';
  return new Date(value).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', year: undefined,
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

function toDatetimeLocal(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function taskDateKey(value?: string | null) {
  return value ? new Date(value).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' }) : 'Без срока';
}

function isOverdue(task: TaskRow) {
  return Boolean(task.due_at && task.status !== 'done' && new Date(task.due_at).getTime() < Date.now());
}

function Avatar({ agent, size = 34 }: { agent?: Agent; size?: number }) {
  return (
    <span
      className="inline-grid place-items-center shrink-0 rounded-full bg-[#E8EEFF] text-[#3157DE] font-bold overflow-hidden"
      style={{ width: size, height: size, fontSize: Math.max(11, size * .36) }}
    >
      {agent?.avatar_url ? <img src={agent.avatar_url} alt="" className="w-full h-full object-cover" /> : (agent?.name?.slice(0, 1) || '?').toUpperCase()}
    </span>
  );
}

export default function Tasks() {
  const [, setLocation] = useLocation();
  const { clinicId, user, userRole } = useAuth();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [members, setMembers] = useState<DepartmentMember[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selected, setSelected] = useState<TaskRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('mine');
  const [view, setView] = useState<TaskView>('list');
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [newChecklist, setNewChecklist] = useState('');
  const [form, setForm] = useState({
    departmentId: '', assigneeId: '', leadId: '', title: '', description: '', dueAt: '',
    priority: 'normal' as TaskPriority, requiresReview: false, checklist: '', watcherIds: [] as string[],
  });

  const myAgent = useMemo(() => agents.find(agent => agent.user_id === user?.id) ?? null, [agents, user?.id]);
  const canManage = managerRoles.has(userRole ?? '');
  const selectedDepartment = departments.find(item => item.id === form.departmentId) ?? null;
  const departmentAgents = selectedDepartment
    ? agents.filter(agent => members.some(member => member.department_id === selectedDepartment.id && member.agent_id === agent.id))
    : [];

  const load = async () => {
    if (!clinicId) return;
    setLoading(true);
    try {
      const [taskRes, agentRes, departmentRes, memberRes, leadRes] = await Promise.all([
        supabase.from('tasks').select('*').eq('clinic_id', clinicId).order('due_at', { ascending: true, nullsFirst: false }),
        supabase.from('agents').select('id, name, user_id, avatar_url').eq('clinic_id', clinicId).order('name'),
        supabase.from('departments').select('id, name, manager_id, color, is_active').eq('clinic_id', clinicId).eq('is_active', true).order('name'),
        supabase.from('department_members').select('department_id, agent_id, is_primary'),
        supabase.from('leads').select('id, full_name, phone').eq('clinic_id', clinicId).eq('pipeline', 'sales').order('updated_at', { ascending: false }).limit(300),
      ]);
      if (taskRes.error) throw taskRes.error;
      if (agentRes.error) throw agentRes.error;
      if (departmentRes.error) throw departmentRes.error;
      setTasks((taskRes.data ?? []) as TaskRow[]);
      setAgents((agentRes.data ?? []) as Agent[]);
      setDepartments((departmentRes.data ?? []) as Department[]);
      setMembers((memberRes.data ?? []) as DepartmentMember[]);
      setLeads((leadRes.data ?? []) as Lead[]);
    } catch (error: any) {
      toast.error(error.message || 'Не удалось загрузить задачи');
    } finally {
      setLoading(false);
    }
  };

  const loadTaskDetails = async (task: TaskRow) => {
    setSelected(task);
    const [checkRes, commentRes, eventRes, attachmentRes] = await Promise.all([
      supabase.from('task_checklist_items').select('*').eq('task_id', task.id).order('position'),
      supabase.from('task_comments').select('*').eq('task_id', task.id).order('created_at'),
      supabase.from('task_events').select('*').eq('task_id', task.id).order('created_at', { ascending: false }),
      supabase.from('task_attachments').select('*').eq('task_id', task.id).order('created_at', { ascending: false }),
    ]);
    setChecklist((checkRes.data ?? []) as ChecklistItem[]);
    setComments((commentRes.data ?? []) as TaskComment[]);
    setEvents((eventRes.data ?? []) as TaskEvent[]);
    setAttachments((attachmentRes.data ?? []) as TaskAttachment[]);
  };

  useEffect(() => { void load(); }, [clinicId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('create') === '1') setCreateOpen(true);
    const taskId = params.get('task');
    if (taskId) {
      const task = tasks.find(item => item.id === taskId);
      if (task) void loadTaskDetails(task);
    }
  }, [tasks]);

  useEffect(() => {
    if (!clinicId) return;
    const channel = supabase
      .channel(`tasks-live-${clinicId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `clinic_id=eq.${clinicId}` }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [clinicId]);

  const logEvent = async (taskId: string, type: string, payload: Record<string, string> = {}) => {
    await supabase.from('task_events').insert({ task_id: taskId, actor_id: myAgent?.id ?? null, type, payload });
  };

  const sendTaskCard = async (task: TaskRow, assigneeId: string, body = `Новая задача: ${task.title}`) => {
    if (!clinicId || !myAgent?.id || !assigneeId || assigneeId === myAgent.id) return;
    try {
      const { data: directConversations } = await supabase
        .from('chat_conversations').select('id').eq('clinic_id', clinicId).eq('type', 'direct');
      const directIds = (directConversations ?? []).map(row => row.id);
      let conversationId: string | undefined;
      if (directIds.length) {
        const { data: conversationMembers } = await supabase
          .from('chat_members').select('conversation_id, agent_id').in('conversation_id', directIds).in('agent_id', [myAgent.id, assigneeId]);
        const pairs = new Map<string, Set<string>>();
        (conversationMembers ?? []).forEach(row => pairs.set(row.conversation_id, new Set([...(pairs.get(row.conversation_id) ?? []), row.agent_id])));
        conversationId = [...pairs.entries()].find(([, pair]) => pair.has(myAgent.id) && pair.has(assigneeId))?.[0];
      }
      if (!conversationId) {
        const assignee = agents.find(agent => agent.id === assigneeId);
        const { data: conversation, error } = await supabase
          .from('chat_conversations')
          .insert({ clinic_id: clinicId, type: 'direct', title: assignee?.name || 'Задача', created_by: user?.id ?? null })
          .select('id').single();
        if (error || !conversation) return;
        conversationId = conversation.id;
        await supabase.from('chat_members').insert([myAgent.id, assigneeId].map(agentId => ({
          clinic_id: clinicId, conversation_id: conversationId, agent_id: agentId,
          user_id: agents.find(agent => agent.id === agentId)?.user_id ?? null,
        })));
      }
      await supabase.from('chat_messages').insert({
        clinic_id: clinicId, conversation_id: conversationId, sender_agent_id: myAgent.id,
        sender_user_id: user?.id ?? null, body,
        message_type: 'task',
        metadata: { task_id: task.id, title: task.title, due_at: task.due_at, priority: task.priority, lead_id: task.lead_id },
      });
    } catch {
      // Chat is an extra delivery channel. A task must not fail because of it.
    }
  };

  const notify = async (task: TaskRow, recipientId: string | null, title: string, body: string) => {
    if (!clinicId || !recipientId) return;
    await supabase.from('task_notifications').insert({
      clinic_id: clinicId, recipient_agent_id: recipientId, task_id: task.id, title, body,
    });
  };

  const createTask = async (event: FormEvent) => {
    event.preventDefault();
    if (!clinicId || !myAgent?.id) {
      toast.error('Не найден профиль сотрудника');
      return;
    }
    if (!form.departmentId || !form.assigneeId || !form.title.trim()) {
      toast.error('Заполните отдел, сотрудника и название');
      return;
    }
    setSaving(true);
    let createdTaskId: string | null = null;
    try {
      const { data, error } = await supabase.from('tasks').insert({
        clinic_id: clinicId, department_id: form.departmentId, creator_agent_id: myAgent.id,
        assignee_id: form.assigneeId, lead_id: form.leadId || null, title: form.title.trim(),
        description: form.description.trim(), priority: form.priority,
        due_at: form.dueAt ? new Date(form.dueAt).toISOString() : null,
        requires_review: form.requiresReview,
      }).select('*').single();
      if (error) throw error;
      const task = data as TaskRow;
      createdTaskId = task.id;
      const items = form.checklist.split('\n').map(text => text.trim()).filter(Boolean);
      if (items.length) {
        const { error: checklistError } = await supabase
          .from('task_checklist_items')
          .insert(items.map((text, position) => ({ task_id: task.id, text, position })));
        if (checklistError) throw checklistError;
      }
      const watcherIds = form.watcherIds.filter(id => id !== form.assigneeId);
      if (watcherIds.length) {
        const { error: watchersError } = await supabase
          .from('task_watchers')
          .insert(watcherIds.map(agent_id => ({ task_id: task.id, agent_id })));
        if (watchersError) throw watchersError;
      }
      await logEvent(task.id, 'created', { title: task.title });
      await notify(task, task.assignee_id, 'Новая задача', task.title);
      await Promise.all(watcherIds.map(id => notify(task, id, 'Вы добавлены наблюдателем', task.title)));
      await sendTaskCard(task, form.assigneeId);
      setCreateOpen(false);
      setForm({ departmentId: '', assigneeId: '', leadId: '', title: '', description: '', dueAt: '', priority: 'normal', requiresReview: false, checklist: '', watcherIds: [] });
      await load();
      await loadTaskDetails(task);
      toast.success('Задача поставлена');
    } catch (error: any) {
      if (createdTaskId) {
        const { error: rollbackError } = await supabase.from('tasks').delete().eq('id', createdTaskId);
        if (rollbackError) console.error('task creation rollback failed', rollbackError);
      }
      toast.error(error.message || 'Не удалось создать задачу');
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (task: TaskRow, status: TaskStatus) => {
    const fields: Record<string, string | null> = { status, updated_at: new Date().toISOString() };
    if (status === 'in_progress' && !task.accepted_at) fields.accepted_at = new Date().toISOString();
    if (status === 'in_progress') fields.started_at = new Date().toISOString();
    if (status === 'done') fields.completed_at = new Date().toISOString();
    const { data, error } = await supabase.from('tasks').update(fields).eq('id', task.id).select('*').single();
    if (error) {
      toast.error(error.message);
      return;
    }
    await logEvent(task.id, `status_${status}`);
    if (task.creator_agent_id && task.creator_agent_id !== myAgent?.id) await notify(data as TaskRow, task.creator_agent_id, 'Статус задачи изменён', `${task.title}: ${statusMeta[status].label}`);
    const updatedTask = data as TaskRow;
    if (task.creator_agent_id && task.creator_agent_id !== myAgent?.id) {
      await sendTaskCard(updatedTask, task.creator_agent_id, `Задача «${task.title}»: ${statusMeta[status].label}`);
    }
    await load();
    await loadTaskDetails(updatedTask);
  };

  const addComment = async () => {
    if (!selected || !commentText.trim()) return;
    const { data, error } = await supabase.from('task_comments').insert({ task_id: selected.id, author_id: myAgent?.id ?? null, body: commentText.trim() }).select('*').single();
    if (error) {
      toast.error(error.message);
      return;
    }
    await logEvent(selected.id, 'commented');
    setComments(prev => [...prev, data as TaskComment]);
    setCommentText('');
  };

  const requestDeadlineChange = async (task: TaskRow, dueAt: string) => {
    if (!dueAt || !task.creator_agent_id) return;
    const requested = new Date(dueAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    const { data, error } = await supabase.from('task_comments').insert({
      task_id: task.id, author_id: myAgent?.id ?? null, body: `Запрошен перенос срока: ${requested}`,
    }).select('*').single();
    if (error) {
      toast.error(error.message);
      return;
    }
    await logEvent(task.id, 'deadline_change_requested', { requested_due_at: new Date(dueAt).toISOString() });
    await notify(task, task.creator_agent_id, 'Запрос на перенос срока', `${task.title}: до ${requested}`);
    await sendTaskCard(task, task.creator_agent_id, `Запрошен перенос срока задачи «${task.title}» до ${requested}`);
    setComments(previous => [...previous, data as TaskComment]);
    toast.success('Запрос на перенос отправлен руководителю');
  };

  const toggleChecklist = async (item: ChecklistItem) => {
    if (!selected) return;
    const next = !item.is_done;
    const { error } = await supabase.from('task_checklist_items').update({
      is_done: next, completed_by: next ? myAgent?.id ?? null : null, completed_at: next ? new Date().toISOString() : null,
    }).eq('id', item.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await logEvent(selected.id, next ? 'checklist_completed' : 'checklist_reopened', { item: item.text });
    setChecklist(prev => prev.map(row => row.id === item.id ? { ...row, is_done: next } : row));
  };

  const addChecklist = async () => {
    if (!selected || !newChecklist.trim()) return;
    const { data, error } = await supabase.from('task_checklist_items').insert({ task_id: selected.id, text: newChecklist.trim(), position: checklist.length }).select('*').single();
    if (error) {
      toast.error(error.message);
      return;
    }
    setChecklist(prev => [...prev, data as ChecklistItem]);
    setNewChecklist('');
  };

  const uploadAttachment = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selected || !clinicId) return;
    const maxFileSize = 10 * 1024 * 1024;
    const allowedMimeTypes = new Set([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'text/plain',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]);

    if (file.size > maxFileSize) {
      toast.error('Размер файла не должен превышать 10 МБ');
      event.target.value = '';
      return;
    }
    if (!allowedMimeTypes.has(file.type)) {
      toast.error('Можно прикрепить PDF, DOCX, TXT, JPG, PNG или WEBP');
      event.target.value = '';
      return;
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${clinicId}/${selected.id}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from('task-attachments').upload(path, file);
    if (uploadError) {
      toast.error(uploadError.message);
      return;
    }
    const { data, error } = await supabase.from('task_attachments').insert({
      task_id: selected.id, uploaded_by: myAgent?.id ?? null, file_name: file.name, file_path: path,
      mime_type: file.type || null, size_bytes: file.size,
    }).select('*').single();
    if (error) {
      toast.error(error.message);
      return;
    }
    await logEvent(selected.id, 'attachment_added', { name: file.name });
    setAttachments(prev => [data as TaskAttachment, ...prev]);
    event.target.value = '';
  };

  const deleteTask = async (task: TaskRow) => {
    if (!canManage && task.creator_agent_id !== myAgent?.id) return;
    if (!window.confirm(`Удалить задачу «${task.title}»?`)) return;
    const { error } = await supabase.from('tasks').delete().eq('id', task.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSelected(null);
    await load();
    toast.success('Задача удалена');
  };

  const availableTasks = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tasks.filter(task => {
      const isMine = task.assignee_id === myAgent?.id;
      if (!canManage && !isMine) return false;
      if (filter === 'mine' && !isMine) return false;
      if (filter === 'today' && (!task.due_at || new Date(task.due_at).toDateString() !== new Date().toDateString())) return false;
      if (filter === 'overdue' && !isOverdue(task)) return false;
      if (filter === 'review' && task.status !== 'review') return false;
      if (filter === 'working' && task.status !== 'in_progress') return false;
      if (filter === 'done' && task.status !== 'done') return false;
      if (filter === 'created' && task.creator_agent_id !== myAgent?.id) return false;
      if (filter === 'departments' && !task.department_id) return false;
      if (!query) return true;
      const lead = leads.find(item => item.id === task.lead_id);
      return [task.title, task.description, lead?.full_name, lead?.phone].filter(Boolean).join(' ').toLowerCase().includes(query);
    });
  }, [tasks, search, filter, myAgent?.id, canManage, leads]);

  const agentById = (id?: string | null) => agents.find(agent => agent.id === id);
  const departmentById = (id?: string | null) => departments.find(item => item.id === id);
  const leadById = (id?: string | null) => leads.find(item => item.id === id);
  const filters = canManage
    ? [['created', 'Поставленные мной'], ['all', 'Все задачи'], ['departments', 'По отделам'], ['overdue', 'Просроченные'], ['review', 'На проверке'], ['done', 'Выполненные']]
    : [['mine', 'Мои задачи'], ['today', 'На сегодня'], ['overdue', 'Просроченные'], ['working', 'В работе'], ['review', 'На проверке'], ['done', 'Выполненные']];

  const TaskCard = ({ task, compact = false }: { task: TaskRow; compact?: boolean }) => {
    const assignee = agentById(task.assignee_id);
    const lead = leadById(task.lead_id);
    const department = departmentById(task.department_id);
    return (
      <button type="button" onClick={() => void loadTaskDetails(task)} className={`w-full text-left rounded-2xl border border-[#E7ECF3] bg-white p-${compact ? '3' : '4'} shadow-sm transition hover:border-[#BFD0FF] hover:shadow-md`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-[#10264B] truncate">{task.title}</p>
            {lead && <p className="text-xs mt-1 text-[#71829D] truncate">{lead.full_name || 'Клиент'}{lead.phone ? ` · ${lead.phone}` : ''}</p>}
          </div>
          <span className="shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold" style={{ color: priorityMeta[task.priority].color, background: `${priorityMeta[task.priority].color}12` }}>{priorityMeta[task.priority].label}</span>
        </div>
        {!compact && task.description && <p className="mt-3 text-sm leading-5 text-[#52657F] line-clamp-2">{task.description}</p>}
        <div className="mt-4 flex items-center justify-between gap-3 text-xs text-[#71829D]">
          <span className="inline-flex min-w-0 items-center gap-1.5 truncate"><Avatar agent={assignee} size={22} />{assignee?.name || 'Не назначен'}</span>
          <span className={`inline-flex shrink-0 items-center gap-1 ${isOverdue(task) ? 'text-[#DC2626]' : ''}`}><Clock3 size={13} />{formatDate(task.due_at)}</span>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="rounded-full px-2 py-1 text-[11px] font-semibold" style={{ color: statusMeta[task.status].color, background: `${statusMeta[task.status].color}12` }}>{statusMeta[task.status].label}</span>
          {department && <span className="text-[11px] text-[#71829D]">{department.name}</span>}
        </div>
      </button>
    );
  };

  const kanbanColumns: TaskStatus[] = ['new', 'in_progress', 'review', 'done'];

  return (
    <PageLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><h1 className="text-3xl font-bold tracking-tight text-[#10264B]">Задачи</h1><p className="mt-1 text-sm text-[#71829D]">Постановка, контроль и история выполнения без задач, спрятанных в комментариях.</p></div>
          {canManage && <button type="button" onClick={() => setCreateOpen(true)} className="neu-btn-primary"><Plus size={17} />Поставить задачу</button>}
        </div>

        <section className="neu-card p-4 flex flex-wrap items-center gap-3">
          <label className="relative min-w-[220px] flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8]" /><input className="neu-input pl-9 text-sm" placeholder="Название, клиент или телефон" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <div className="flex max-w-full gap-2 overflow-x-auto pb-1">{filters.map(([id, label]) => <button key={id} type="button" onClick={() => setFilter(id)} className={`rounded-xl px-3.5 py-2 text-sm font-medium whitespace-nowrap ${filter === id ? 'bg-[#1E325C] text-white' : 'bg-[#F5F8FC] text-[#52657F] hover:bg-[#E9F0FF]'}`}>{label}</button>)}</div>
          <div className="ml-auto flex rounded-xl border border-[#E3EAF2] p-1">{([['list', 'Список'], ['kanban', 'Канбан'], ['calendar', 'Календарь'], ['table', 'Таблица']] as [TaskView, string][]).map(([id, label]) => <button key={id} type="button" onClick={() => setView(id)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${view === id ? 'bg-[#EAF0FF] text-[#3157DE]' : 'text-[#71829D]'}`}>{label}</button>)}</div>
        </section>

        {loading ? <div className="py-24 text-center text-[#71829D]"><Loader2 className="mx-auto mb-3 animate-spin" />Загружаю задачи…</div> : view === 'kanban' ? (
          <div className="grid min-h-[520px] grid-cols-1 gap-4 xl:grid-cols-4">{kanbanColumns.map(status => <section key={status} className="rounded-2xl border border-[#E4EBF4] bg-[#F8FAFD] p-3"><header className="mb-3 flex items-center justify-between px-1"><span className="font-semibold text-[#10264B]">{statusMeta[status].label}</span><span className="rounded-full bg-white px-2 py-0.5 text-xs text-[#71829D]">{availableTasks.filter(task => task.status === status).length}</span></header><div className="space-y-3">{availableTasks.filter(task => task.status === status).map(task => <TaskCard key={task.id} task={task} compact />)}{availableTasks.filter(task => task.status === status).length === 0 && <p className="py-10 text-center text-sm text-[#9AAAC0]">Нет задач</p>}</div></section>)}</div>
        ) : view === 'calendar' ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">{Object.entries(availableTasks.reduce<Record<string, TaskRow[]>>((groups, task) => { const key = taskDateKey(task.due_at); (groups[key] ||= []).push(task); return groups; }, {})).map(([date, rows]) => <section key={date} className="rounded-2xl border border-[#E4EBF4] bg-white p-4"><h2 className="mb-4 font-semibold text-[#10264B]">{date}</h2><div className="space-y-3">{rows.map(task => <TaskCard key={task.id} task={task} compact />)}</div></section>)}</div>
        ) : view === 'table' ? (
          <section className="overflow-x-auto rounded-2xl border border-[#E4EBF4] bg-white"><table className="w-full min-w-[900px] text-left"><thead className="border-b border-[#EDF1F7] text-xs uppercase tracking-wide text-[#7C8DA7]"><tr><th className="px-5 py-4">Задача</th><th>Отдел</th><th>Исполнитель</th><th>Срок</th><th>Статус</th><th className="px-5"> </th></tr></thead><tbody>{availableTasks.map(task => <tr key={task.id} className="border-b border-[#F0F3F8] hover:bg-[#FAFBFE]"><td className="px-5 py-4"><p className="font-semibold text-[#10264B]">{task.title}</p><p className="mt-1 text-xs text-[#71829D]">{leadById(task.lead_id)?.full_name || 'Без клиента'}</p></td><td className="text-sm text-[#52657F]">{departmentById(task.department_id)?.name || '—'}</td><td className="text-sm text-[#52657F]">{agentById(task.assignee_id)?.name || 'Не назначен'}</td><td className={`text-sm ${isOverdue(task) ? 'text-[#DC2626]' : 'text-[#52657F]'}`}>{formatDate(task.due_at)}</td><td><span className="rounded-full px-2 py-1 text-xs" style={{ background: `${statusMeta[task.status].color}12`, color: statusMeta[task.status].color }}>{statusMeta[task.status].label}</span></td><td className="px-5"><button onClick={() => void loadTaskDetails(task)} className="text-sm font-semibold text-[#3157DE]">Открыть</button></td></tr>)}</tbody></table></section>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">{availableTasks.map(task => <TaskCard key={task.id} task={task} />)}{availableTasks.length === 0 && <div className="col-span-full py-24 text-center text-[#94A3B8]">Задач по этому фильтру нет.</div>}</div>
        )}
      </div>

      {createOpen && <TaskFormDrawer
        departments={departments} agents={agents} members={members} leads={leads} form={form} setForm={setForm}
        departmentAgents={departmentAgents} saving={saving} onClose={() => { setCreateOpen(false); setLocation('/tasks'); }} onSubmit={createTask}
      />}

      {selected && <TaskDrawer
        task={selected} agentById={agentById} departmentById={departmentById} leadById={leadById} checklist={checklist}
        comments={comments} events={events} attachments={attachments} commentText={commentText} setCommentText={setCommentText}
        newChecklist={newChecklist} setNewChecklist={setNewChecklist} myAgentId={myAgent?.id ?? null} canManage={canManage}
        onClose={() => { setSelected(null); setLocation('/tasks'); }} onStatus={updateStatus} onAddComment={addComment}
        onToggleChecklist={toggleChecklist} onAddChecklist={addChecklist} onUpload={uploadAttachment} onDelete={deleteTask}
        onRequestDeadline={requestDeadlineChange}
      />}
    </PageLayout>
  );
}

function TaskFormDrawer({ departments, agents, members, leads, form, setForm, departmentAgents, saving, onClose, onSubmit }: {
  departments: Department[]; agents: Agent[]; members: DepartmentMember[]; leads: Lead[];
  form: { departmentId: string; assigneeId: string; leadId: string; title: string; description: string; dueAt: string; priority: TaskPriority; requiresReview: boolean; checklist: string; watcherIds: string[] };
  setForm: React.Dispatch<React.SetStateAction<typeof form>>; departmentAgents: Agent[]; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent) => void;
}) {
  const change = (key: keyof typeof form, value: string | boolean | string[]) => setForm(previous => ({ ...previous, [key]: value }));
  return <Drawer title="Поставить задачу" onClose={onClose}><form onSubmit={onSubmit} className="space-y-5">
    <Field label="Отдел"><select className="neu-input" value={form.departmentId} onChange={event => setForm(previous => ({ ...previous, departmentId: event.target.value, assigneeId: '' }))}><option value="">Выберите отдел</option>{departments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
    <Field label="Сотрудник"><select className="neu-input" value={form.assigneeId} disabled={!form.departmentId} onChange={event => change('assigneeId', event.target.value)}><option value="">{form.departmentId ? 'Выберите сотрудника' : 'Сначала выберите отдел'}</option>{departmentAgents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select>{form.departmentId && departmentAgents.length === 0 && <p className="mt-1 text-xs text-[#DC2626]">В отдел пока не добавлены сотрудники.</p>}</Field>
    <Field label="Контакт / клиент (необязательно)"><select className="neu-input" value={form.leadId} onChange={event => change('leadId', event.target.value)}><option value="">Без клиента</option>{leads.map(lead => <option key={lead.id} value={lead.id}>{lead.full_name || 'Без имени'}{lead.phone ? ` · ${lead.phone}` : ''}</option>)}</select></Field>
    <Field label="Название задачи"><input className="neu-input" required value={form.title} onChange={event => change('title', event.target.value)} placeholder="Например: подтвердить запись" /></Field>
    <Field label="Подробное описание"><textarea className="neu-input min-h-28 py-3" value={form.description} onChange={event => change('description', event.target.value)} placeholder="Что именно нужно сделать и какой результат ожидается" /></Field>
    <div className="grid grid-cols-2 gap-4"><Field label="Срок и время"><input type="datetime-local" className="neu-input" value={form.dueAt} onChange={event => change('dueAt', event.target.value)} /></Field><Field label="Приоритет"><select className="neu-input" value={form.priority} onChange={event => change('priority', event.target.value as TaskPriority)}><option value="normal">Обычный</option><option value="important">Важный</option><option value="urgent">Срочный</option></select></Field></div>
    <Field label="Чек-лист"><textarea className="neu-input min-h-24 py-3" value={form.checklist} onChange={event => change('checklist', event.target.value)} placeholder="Один пункт на строку" /></Field>
    <label className="flex items-center gap-3 rounded-xl border border-[#E3EAF2] p-4 text-sm font-medium text-[#334A6A]"><input type="checkbox" checked={form.requiresReview} onChange={event => change('requiresReview', event.target.checked)} />Нужна проверка руководителем</label>
    <Field label="Наблюдатели"><div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto rounded-xl border border-[#E3EAF2] p-3">{agents.map(agent => <label key={agent.id} className="flex items-center gap-2 text-sm text-[#52657F]"><input type="checkbox" checked={form.watcherIds.includes(agent.id)} onChange={event => change('watcherIds', event.target.checked ? [...form.watcherIds, agent.id] : form.watcherIds.filter(id => id !== agent.id))} />{agent.name}</label>)}</div></Field>
    <button disabled={saving} className="neu-btn-primary w-full justify-center py-3">{saving ? <Loader2 className="animate-spin" /> : <Check size={17} />}Поставить задачу</button>
  </form></Drawer>;
}

function TaskDrawer({ task, agentById, departmentById, leadById, checklist, comments, events, attachments, commentText, setCommentText, newChecklist, setNewChecklist, myAgentId, canManage, onClose, onStatus, onAddComment, onToggleChecklist, onAddChecklist, onUpload, onDelete, onRequestDeadline }: {
  task: TaskRow; agentById: (id?: string | null) => Agent | undefined; departmentById: (id?: string | null) => Department | undefined; leadById: (id?: string | null) => Lead | undefined;
  checklist: ChecklistItem[]; comments: TaskComment[]; events: TaskEvent[]; attachments: TaskAttachment[]; commentText: string; setCommentText: (value: string) => void; newChecklist: string; setNewChecklist: (value: string) => void; myAgentId: string | null; canManage: boolean;
  onClose: () => void; onStatus: (task: TaskRow, status: TaskStatus) => void; onAddComment: () => void; onToggleChecklist: (item: ChecklistItem) => void; onAddChecklist: () => void; onUpload: (event: ChangeEvent<HTMLInputElement>) => void; onDelete: (task: TaskRow) => void; onRequestDeadline: (task: TaskRow, dueAt: string) => void;
}) {
  const assignee = agentById(task.assignee_id); const lead = leadById(task.lead_id); const department = departmentById(task.department_id);
  const canAct = task.assignee_id === myAgentId || canManage;
  const [requestedDueAt, setRequestedDueAt] = useState('');
  const action: [string, TaskStatus] | null = task.status === 'new'
    ? ['Принять и начать', 'in_progress']
    : task.status === 'in_progress'
      ? [task.requires_review ? 'Отправить на проверку' : 'Выполнено', task.requires_review ? 'review' : 'done']
      : task.status === 'returned' ? ['Продолжить работу', 'in_progress'] : null;
  const completed = checklist.filter(item => item.is_done).length;
  return <Drawer title="Задача" onClose={onClose} wide>
    <div className="space-y-6">
      <div><div className="flex flex-wrap gap-2"><span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ color: statusMeta[task.status].color, background: `${statusMeta[task.status].color}12` }}>{statusMeta[task.status].label}</span><span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ color: priorityMeta[task.priority].color, background: `${priorityMeta[task.priority].color}12` }}>{priorityMeta[task.priority].label}</span>{task.requires_review && <span className="rounded-full bg-[#FFF7E8] px-2.5 py-1 text-xs font-semibold text-[#A16207]">Требует проверки</span>}</div><h2 className="mt-3 text-2xl font-bold text-[#10264B]">{task.title}</h2>{task.description && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#52657F]">{task.description}</p>}</div>
      <div className="grid grid-cols-2 gap-3 rounded-2xl bg-[#F7F9FD] p-4 text-sm"><Info label="Отдел" value={department?.name || 'Не выбран'} /><Info label="Исполнитель" value={assignee?.name || 'Не назначен'} /><Info label="Клиент" value={lead ? `${lead.full_name || 'Клиент'}${lead.phone ? ` · ${lead.phone}` : ''}` : 'Не привязан'} /><Info label="Срок" value={formatDate(task.due_at)} danger={isOverdue(task)} /></div>
      {(action || task.status === 'review') && <div className="grid grid-cols-2 gap-3">{action && canAct && <button onClick={() => onStatus(task, action[1])} className="neu-btn-primary justify-center">{action[0]}</button>}{task.status === 'review' && canManage && <><button onClick={() => onStatus(task, 'done')} className="rounded-xl bg-[#16A34A] px-4 py-3 font-semibold text-white">Принять результат</button><button onClick={() => onStatus(task, 'returned')} className="rounded-xl border border-[#FED7AA] bg-[#FFF7ED] px-4 py-3 font-semibold text-[#C2410C]">Вернуть в работу</button></>}</div>}
      {canAct && task.status !== 'done' && <div className="rounded-2xl border border-[#E4EBF4] bg-[#FAFBFE] p-4"><p className="mb-2 text-sm font-semibold text-[#334A6A]">Запросить перенос срока</p><div className="flex gap-2"><input type="datetime-local" className="neu-input text-sm" value={requestedDueAt} onChange={event => setRequestedDueAt(event.target.value)} /><button type="button" onClick={() => { onRequestDeadline(task, requestedDueAt); setRequestedDueAt(''); }} className="neu-btn text-xs">Отправить</button></div></div>}
      <section><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold text-[#10264B]"><ListChecks className="mr-2 inline" size={17} />Чек-лист {checklist.length ? `${completed}/${checklist.length}` : ''}</h3></div><div className="space-y-2">{checklist.map(item => <label key={item.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-[#E8EDF4] px-3 py-2.5 text-sm text-[#405571]"><input type="checkbox" checked={item.is_done} disabled={!canAct} onChange={() => onToggleChecklist(item)} /><span className={item.is_done ? 'line-through text-[#9AAAC0]' : ''}>{item.text}</span></label>)}</div>{canAct && <div className="mt-3 flex gap-2"><input className="neu-input text-sm" value={newChecklist} onChange={event => setNewChecklist(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onAddChecklist(); } }} placeholder="Добавить пункт" /><button onClick={onAddChecklist} className="neu-btn">Добавить</button></div>}</section>
      <section><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold text-[#10264B]"><MessageCircle className="mr-2 inline" size={17} />Комментарии</h3><label className="cursor-pointer rounded-lg border border-[#E3EAF2] px-3 py-2 text-xs font-semibold text-[#3157DE]"><FileUp className="mr-1 inline" size={13} />Файл<input type="file" className="hidden" onChange={onUpload} /></label></div>{attachments.length > 0 && <div className="mb-3 flex flex-wrap gap-2">{attachments.map(file => <span key={file.id} className="rounded-lg bg-[#EEF3FF] px-2.5 py-1.5 text-xs text-[#3157DE]">{file.file_name}</span>)}</div>}<div className="space-y-3">{comments.map(comment => <div key={comment.id} className="rounded-xl bg-[#F7F9FD] p-3"><p className="text-sm text-[#334A6A]">{comment.body}</p><p className="mt-1 text-[11px] text-[#91A0B5]">{agentById(comment.author_id)?.name || 'Сотрудник'} · {formatDate(comment.created_at)}</p></div>)}</div><div className="mt-3 flex gap-2"><textarea className="neu-input min-h-20 py-2 text-sm" value={commentText} onChange={event => setCommentText(event.target.value)} placeholder="Написать комментарий" /><button onClick={onAddComment} className="neu-btn-primary self-end"><Send size={16} /></button></div></section>
      <section><h3 className="mb-3 font-semibold text-[#10264B]">История</h3><div className="space-y-2 border-l border-[#D9E2EF] pl-4">{events.map(event => <div key={event.id} className="text-sm text-[#52657F]"><span className="font-medium text-[#334A6A]">{agentById(event.actor_id)?.name || 'Система'}</span> · {event.type.replaceAll('_', ' ')}<span className="ml-2 text-xs text-[#9AAAC0]">{formatDate(event.created_at)}</span></div>)}</div></section>
      {(canManage || task.creator_agent_id === myAgentId) && <button onClick={() => onDelete(task)} className="flex items-center gap-2 text-sm font-semibold text-[#DC2626]"><Trash2 size={15} />Удалить задачу</button>}
    </div>
  </Drawer>;
}

function Drawer({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="fixed inset-0 z-[100] bg-[#10213B]/25 backdrop-blur-[2px]" onMouseDown={onClose}><aside onMouseDown={event => event.stopPropagation()} className={`absolute inset-y-0 right-0 w-full ${wide ? 'max-w-2xl' : 'max-w-xl'} overflow-y-auto border-l border-[#E5EAF2] bg-white p-6 shadow-[-24px_0_60px_rgba(15,23,42,.14)]`}><div className="mb-6 flex items-center justify-between"><h1 className="text-xl font-bold text-[#10264B]">{title}</h1><button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl border border-[#E2E8F0] text-[#52657F]"><X size={17} /></button></div>{children}</aside></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-sm font-semibold text-[#405571]">{label}</span>{children}</label>; }
function Info({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) { return <div><p className="text-xs text-[#8392A8]">{label}</p><p className={`mt-1 font-medium ${danger ? 'text-[#DC2626]' : 'text-[#334A6A]'}`}>{value}</p></div>; }
