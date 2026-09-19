import { createFileRoute } from "@tanstack/react-router";
import { VocalBooth } from "@/components/vocal-booth";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <VocalBooth />;
}
