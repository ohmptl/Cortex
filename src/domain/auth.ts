import { createClient } from "@/lib/supabase/server";
import { AcademicRepository } from "@/domain/repository";

export async function requireAcademicRepository() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error("Authentication required");
  }

  return {
    user,
    repository: new AcademicRepository(supabase, user.id),
  };
}
