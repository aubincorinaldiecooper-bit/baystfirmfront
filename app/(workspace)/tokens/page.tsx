import { redirect } from "next/navigation";
import { TOKENS_REDIRECT } from "@/lib/navigation/legacy";

export default function TokensPage() {
  redirect(TOKENS_REDIRECT);
}
