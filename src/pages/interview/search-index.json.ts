import { getInterviews, interviewUrl } from '../../lib/interviews';

export async function GET() {
  const entries = await getInterviews();
  return new Response(
    JSON.stringify(
      entries.map((entry) => ({
        title: entry.data.title,
        description: entry.data.description,
        href: interviewUrl(entry.slug),
        text: [entry.data.title, entry.data.description, entry.id, ...entry.data.tags, entry.body]
          .join(' ')
          .toLocaleLowerCase()
      }))
    ),
    { headers: { 'Content-Type': 'application/json; charset=utf-8' } }
  );
}
