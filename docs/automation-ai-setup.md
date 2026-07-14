# Автоматизации и AI: запуск

## Что уже есть

- Таблицы правил, запусков, интеграций, событий, метрик, воронки и AI-задач.
- Раздел `Автоматизации` доступен владельцу и руководителю.
- AI работает только через Supabase Edge Function. Браузер не получает ключи OpenAI, Claude или DeepSeek.
- Каждый результат AI сохраняется как `awaiting_confirmation`: модель предлагает, сотрудник решает.

## Установить базу

В Supabase SQL Editor выполните целиком:

`migrations/011_automation_ai_foundation.sql`

Then run `migrations/012_automation_runner.sql`. It creates the `negis-automation-runner` Cron job every five minutes and server-side notifications for default rules.

## Scheduled runner

`012_automation_runner.sql` schedules the default CRM rules inside Supabase every five minutes. No employee browser tab and no Vercel Cron job are involved.

It handles a lead without activity, an overdue task, the daily summary and employee overload. Each execution is written to `automation_runs`; notifications for the responsible employee and manager appear in the CRM bell.

Database Webhooks and Queues can stay enabled. They are reserved for external delivery and retries later: Wazzup, telephony, email and long AI jobs. They are not required for these database-only rules.

## Настроить AI-провайдер

После замены скомпрометированного ключа сохраните новый ключ только в секретах Supabase:

```powershell
npx supabase secrets set DEEPSEEK_API_KEY="NEW_KEY" --project-ref dhsiloxpqwshlezgbodc
npx supabase functions deploy ai-run --project-ref dhsiloxpqwshlezgbodc
```

Аналогично можно задать `OPENAI_API_KEY` или `ANTHROPIC_API_KEY`. Не добавляйте эти значения в `VITE_*`, `.env` фронтенда или таблицы, доступные через RLS.

## Как работают правила

В миграции создаются четыре включённых по умолчанию правила: лид без ответа 15 минут, просроченная задача, ежедневный отчёт, перегрузка сотрудника. Раздел позволяет отключить их или создать свои правила.

Для исполнения правил по времени нужен отдельный серверный запуск по расписанию: Supabase Cron или Vercel Cron вызывает worker, который создаёт записи в `automation_runs`, уведомления и задачи. Это намеренно не делается из браузера: открытая вкладка сотрудника не может быть планировщиком. Очень удобно, но работает примерно как будильник без батарейки.

## Границы данных

`integration_connections` хранит состояние подключения конкретной организации к Wazzup, телефонии или платежам. Секреты находятся отдельно в `integration_secrets` без frontend-политик RLS. Соединения разных организаций изолированы по `clinic_id` (это старое имя поля; по смыслу это workspace/организация).
