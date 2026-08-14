import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-foreground">
      <p className="font-mono text-5xl font-semibold tracking-tight tabular-nums">404</p>
      <p className="mt-3 text-sm text-muted-foreground">This page doesn't exist.</p>
      <Link
        to="/app/dashboard"
        className="mt-6 inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Lifeflow
      </Link>
    </div>
  );
}
