ALTER TABLE public.wz_messages
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS file_size bigint;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('wazzup-attachments', 'wazzup-attachments', false, 10485760)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS wazzup_attachments_storage_access ON storage.objects;
CREATE POLICY wazzup_attachments_storage_access ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'wazzup-attachments'
    AND (storage.foldername(name))[1] IN (
      SELECT clinic_id::text
      FROM public.user_roles
      WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'wazzup-attachments'
    AND (storage.foldername(name))[1] IN (
      SELECT clinic_id::text
      FROM public.user_roles
      WHERE user_id = auth.uid()
    )
  );
