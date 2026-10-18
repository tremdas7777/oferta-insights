import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: IndexRedirect,
});

function IndexRedirect() {
  if (typeof window !== "undefined") {
    window.location.replace("/index.html");
  }
  return null;
}
