import { createClient } from '@/lib/supabase/server';
import { isEmployeePortalHost, workspaceHost } from '@/lib/auth/workspace-routing';

export async function resolveEmployeeWorkspaceRedirect(request: Request) {
  const requestUrl = new URL(request.url);
  if (!isEmployeePortalHost(requestUrl.hostname)) return null;

  const supabase = await createClient();
  const { data: claimsResult } = await supabase.auth.getClaims();
  const userId = claimsResult?.claims?.sub;
  if (!userId) return null;

  const [{ data: profile }, { data: employee }] = await Promise.all([
    supabase.from('profiles').select('status').eq('id', userId).maybeSingle(),
    supabase.from('employee_profiles').select('workspace_slug,employment_status').eq('user_id', userId).maybeSingle(),
  ]);
  if (profile?.status !== 'active' || employee?.employment_status !== 'active') return null;

  const host = workspaceHost(employee.workspace_slug);
  return host ? `https://${host}/dashboard` : null;
}
