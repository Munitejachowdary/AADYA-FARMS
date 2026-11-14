import { redirect } from "next/navigation";

export default function Home() {
  redirect("/ledger/index.html?v=10");
}
