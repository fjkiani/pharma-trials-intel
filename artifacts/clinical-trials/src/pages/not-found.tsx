import { LayoutShell } from "@/components/layout-shell";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <LayoutShell>
      <div className="flex h-full flex-col items-center justify-center text-center">
        <h1 className="text-4xl font-bold tracking-tight mb-2">404 - Page Not Found</h1>
        <p className="text-muted-foreground max-w-md mb-6">
          The page you are looking for does not exist or has been moved.
        </p>
        <Button asChild>
          <Link href="/regulatory">Return to Timeline</Link>
        </Button>
      </div>
    </LayoutShell>
  );
}
