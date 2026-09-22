import { redirect } from "next/navigation";

export default function VisionLabPage() {
  redirect("/annotations?tool=ai");
}
