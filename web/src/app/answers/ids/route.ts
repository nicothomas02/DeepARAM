import answers from "@/data/visitor-answers.json";

// The ids of answered messages, for the footer box's "We answered your message" note (components/FeedbackBox.tsx).
export const dynamic = "force-static";

export function GET() {
  return Response.json((answers as { id: string }[]).map((a) => a.id));
}
