import { useMemo, useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { useLocation } from 'wouter';
import { PageLayout } from '@/components/layout/PageLayout';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { SELECTABLE_MODULES, type WorkspaceModuleKey } from '@/lib/modules';
import { INDUSTRY_OPTIONS, VERTICALS, type IndustrySlug } from '@/lib/verticals/config';
import { toast } from 'sonner';

interface DepartmentDraft {
  id: string;
  name: string;
  color: string;
}

const BUSINESS_TYPE_BY_INDUSTRY: Record<IndustrySlug, string> = {
  clinic: 'private_clinic',
  beauty: 'beauty_salon',
  fitness: 'fitness_wellness',
  education: 'education_courses',
  custom: 'other',
};

const RECOMMENDED_MODULES: Partial<Record<IndustrySlug, WorkspaceModuleKey[]>> = {
  clinic: ['booking', 'reception', 'chat', 'reports'],
  beauty: ['booking', 'reception', 'chat', 'reports'],
  fitness: ['booking', 'chat', 'reports'],
  education: ['booking', 'chat', 'reports'],
  custom: ['chat', 'reports'],
};

export default function Onboarding() {
  const { clinicId, country: storedCountry, industry: storedIndustry, refreshWorkspaceContext } = useAuth();
  const [, setLocation] = useLocation();
  const initialIndustry = INDUSTRY_OPTIONS.includes(storedIndustry as IndustrySlug)
    ? storedIndustry as IndustrySlug
    : 'custom';
  const [step, setStep] = useState(1);
  const [country, setCountry] = useState<'KZ' | 'KG'>(storedCountry === 'KG' ? 'KG' : 'KZ');
  const [industry, setIndustry] = useState<IndustrySlug>(initialIndustry);
  const [selectedModules, setSelectedModules] = useState<WorkspaceModuleKey[]>(
    RECOMMENDED_MODULES[initialIndustry] ?? [],
  );
  const [departments, setDepartments] = useState<DepartmentDraft[]>([
    { id: crypto.randomUUID(), name: 'Продажи', color: '#4F7BFF' },
  ]);
  const [departmentName, setDepartmentName] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedModuleDefinitions = useMemo(
    () => SELECTABLE_MODULES.filter(module => selectedModules.includes(module.key)),
    [selectedModules],
  );

  const toggleModule = (moduleKey: WorkspaceModuleKey) => {
    setSelectedModules(current => current.includes(moduleKey)
      ? current.filter(key => key !== moduleKey)
      : [...current, moduleKey]);
  };

  const changeIndustry = (nextIndustry: IndustrySlug) => {
    setIndustry(nextIndustry);
    setSelectedModules(RECOMMENDED_MODULES[nextIndustry] ?? []);
  };

  const addDepartment = () => {
    const name = departmentName.trim();
    if (!name) return;
    if (departments.some(item => item.name.toLowerCase() === name.toLowerCase())) {
      toast.error('Такой отдел уже добавлен');
      return;
    }
    setDepartments(current => [...current, { id: crypto.randomUUID(), name, color: '#4F7BFF' }]);
    setDepartmentName('');
  };

  const finishOnboarding = async () => {
    if (!clinicId) {
      toast.error('Рабочее пространство не найдено');
      return;
    }
    if (!departments.some(item => item.name.trim())) {
      toast.error('Добавьте хотя бы один отдел');
      setStep(3);
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.rpc('negis_complete_onboarding', {
        target_clinic_id: clinicId,
        payload: {
          country,
          industry,
          business_type: BUSINESS_TYPE_BY_INDUSTRY[industry],
          modules: selectedModules,
          departments: departments
            .filter(item => item.name.trim())
            .map(item => ({ name: item.name.trim(), color: item.color })),
        },
      });
      if (error) throw error;

      await refreshWorkspaceContext();
      toast.success('Рабочее пространство настроено');
      setLocation('/dashboard');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось завершить настройку');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageLayout>
      <div className="mx-auto mt-6 max-w-3xl">
        <div className="mb-8">
          <div className="h-2 w-full overflow-hidden rounded-full bg-border">
            <div className="h-full bg-primary transition-all duration-300" style={{ width: `${(step / 4) * 100}%` }} />
          </div>
          <div className="mt-2 text-center text-sm font-medium text-muted-foreground">Шаг {step} из 4</div>
        </div>

        <div className="neu-card">
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold">Бизнес и страна</h2>
                <p className="mt-1 text-sm text-muted-foreground">От этого зависят валюта, терминология и доступные интеграции.</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Страна</label>
                  <select className="neu-input bg-transparent" value={country} onChange={event => setCountry(event.target.value as 'KZ' | 'KG')}>
                    <option value="KZ">Казахстан · KZT</option>
                    <option value="KG">Кыргызстан · KGS</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Сфера бизнеса</label>
                  <select className="neu-input bg-transparent" value={industry} onChange={event => changeIndustry(event.target.value as IndustrySlug)}>
                    {INDUSTRY_OPTIONS.map(option => <option key={option} value={option}>{VERTICALS[option].name}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold">Нужные модули</h2>
                <p className="mt-1 text-sm text-muted-foreground">CRM, задачи и администрирование входят в основу. Остальное включается по вашему процессу.</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {SELECTABLE_MODULES.map(module => {
                  const selected = selectedModules.includes(module.key);
                  return (
                    <label key={module.key} className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${selected ? 'border-primary bg-primary/5' : 'border-border bg-white/50'}`}>
                      <input type="checkbox" className="mt-1" checked={selected} onChange={() => toggleModule(module.key)} />
                      <span>
                        <span className="block text-sm font-semibold">{module.label}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">{module.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold">Отделы</h2>
                <p className="mt-1 text-sm text-muted-foreground">Роли сотрудника и отделы — разные вещи. Здесь задаётся структура бизнеса.</p>
              </div>
              <div className="flex gap-3">
                <input
                  className="neu-input flex-1"
                  value={departmentName}
                  placeholder="Например: Продажи, Поддержка, Бухгалтерия"
                  onChange={event => setDepartmentName(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addDepartment();
                    }
                  }}
                />
                <button type="button" className="neu-btn-primary" onClick={addDepartment}><Plus size={16} />Добавить</button>
              </div>
              <div className="space-y-2">
                {departments.map(department => (
                  <div key={department.id} className="flex items-center gap-3 rounded-2xl border border-border bg-white/55 p-3">
                    <input type="color" value={department.color} onChange={event => setDepartments(current => current.map(item => item.id === department.id ? { ...item, color: event.target.value } : item))} />
                    <input className="neu-input flex-1" value={department.name} onChange={event => setDepartments(current => current.map(item => item.id === department.id ? { ...item, name: event.target.value } : item))} />
                    <button type="button" className="neu-btn" title="Удалить отдел" onClick={() => setDepartments(current => current.filter(item => item.id !== department.id))}><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold">Проверка</h2>
                <p className="mt-1 text-sm text-muted-foreground">Настройки можно изменить позже в администрировании и Маркете.</p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-border bg-white/55 p-4">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">Пространство</div>
                  <div className="mt-3 text-sm">{country === 'KG' ? 'Кыргызстан · KGS' : 'Казахстан · KZT'}</div>
                  <div className="mt-1 text-sm">{VERTICALS[industry].name}</div>
                </div>
                <div className="rounded-2xl border border-border bg-white/55 p-4">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">Отделы</div>
                  <div className="mt-3 text-sm">{departments.filter(item => item.name.trim()).map(item => item.name).join(', ') || 'Не добавлены'}</div>
                </div>
              </div>
              <div className="rounded-2xl border border-border bg-white/55 p-4">
                <div className="text-xs font-semibold uppercase text-muted-foreground">Дополнительные модули</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedModuleDefinitions.length ? selectedModuleDefinitions.map(module => (
                    <span key={module.key} className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"><Check size={12} className="mr-1 inline" />{module.label}</span>
                  )) : <span className="text-sm text-muted-foreground">Только базовое CRM-ядро</span>}
                </div>
              </div>
            </div>
          )}

          <div className="mt-8 flex justify-between">
            <button type="button" className="neu-btn" onClick={() => setStep(current => Math.max(1, current - 1))} disabled={step === 1}>Назад</button>
            {step < 4 ? (
              <button type="button" className="neu-btn-primary" onClick={() => setStep(current => Math.min(4, current + 1))}>Далее</button>
            ) : (
              <button type="button" className="neu-btn-primary" disabled={saving} onClick={finishOnboarding}>{saving ? 'Сохранение...' : 'Завершить настройку'}</button>
            )}
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
