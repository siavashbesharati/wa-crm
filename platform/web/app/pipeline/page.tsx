import { redirect } from "next/navigation";

export default async function PipelineRedirect({
  searchParams
}: {
  searchParams: Promise<{ lead?: string }>;
}) {
  const sp = await searchParams;
  redirect(sp.lead ? `/leads?lead=${encodeURIComponent(sp.lead)}` : "/leads");
}
