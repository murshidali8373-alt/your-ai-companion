import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { BuddyLogo } from "@/components/buddy-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

const searchSchema = z.object({
  mode: z.enum(["login", "signup", "reset"]).optional(),
  next: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: (search) => searchSchema.parse(search),
  head: () => ({
    meta: [
      { title: "Sign in to AI Buddy" },
      {
        name: "description",
        content: "Create your AI Buddy account or sign in to continue your 14-day free trial.",
      },
      { property: "og:title", content: "Sign in to AI Buddy" },
      { property: "og:description", content: "Create an account or sign in to your AI Buddy." },
    ],
  }),
  component: AuthPage,
});

function safeNext(next: string | undefined): string {
  if (!next) return "/dashboard";
  if (!next.startsWith("/") || next.startsWith("//")) return "/dashboard";
  return next;
}

function AuthPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup" | "reset">(search.mode ?? "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const next = safeNext(search.next);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: next, replace: true });
    });
  }, [navigate, next]);

  const handleGoogle = async () => {
    setBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: `${window.location.origin}/auth/callback`,
      });
      if (result.error) {
        toast.error("Google sign-in did not complete. Please try again or use email.");
        return;
      }
      if (result.redirected) return;
      const { data } = await supabase.auth.getSession();
      if (data.session) navigate({ to: next, replace: true });
    } catch {
      toast.error("Google sign-in is unavailable right now. Please use email.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth?mode=login`,
        });
        if (error) throw error;
        toast.success("Check your inbox for the reset link.");
        setMode("login");
        return;
      }
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}${next}`,
            data: { display_name: name.trim() || email.split("@")[0] },
          },
        });
        if (error) throw error;
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          toast.success("Welcome. Your 14-day trial has started.");
          navigate({ to: next, replace: true });
        } else {
          toast.success("Account created. Confirm your email, then sign in.");
          setMode("login");
        }
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      navigate({ to: next, replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      toast.error(
        /invalid login/i.test(message)
          ? "That email and password do not match."
          : /already registered/i.test(message)
            ? "That email already has an account. Try signing in."
            : /password/i.test(message)
              ? "Please use a password of at least 6 characters."
              : "That did not work. Please try again in a moment.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hero-surface flex min-h-screen items-center justify-center px-4 py-12">
      <div className="panel w-full max-w-md p-8">
        <div className="flex flex-col items-center text-center">
          <BuddyLogo size={72} />
          <h1 className="mt-3 font-[family-name:var(--font-display)] text-2xl font-semibold">
            {mode === "signup" ? "Start your free trial" : mode === "reset" ? "Reset your password" : "Welcome back"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "signup"
              ? "14 days of every Buddy. No card needed."
              : mode === "reset"
                ? "We will email you a link to set a new password."
                : "Sign in to continue with your Buddy."}
          </p>
        </div>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === "signup" && (
            <div className="space-y-1.5">
              <Label htmlFor="name">Your name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Riya"
                autoComplete="name"
                maxLength={80}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
            />
          </div>
          {mode !== "reset" && (
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
              />
            </div>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy
              ? "Working…"
              : mode === "signup"
                ? "Create account"
                : mode === "reset"
                  ? "Send reset link"
                  : "Sign in"}
          </Button>
        </form>

        {mode !== "reset" && (
          <>
            <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
            </div>
            <Button variant="outline" className="w-full" onClick={handleGoogle} disabled={busy}>
              Continue with Google
            </Button>
          </>
        )}

        <div className="mt-6 space-y-2 text-center text-sm text-muted-foreground">
          {mode === "login" && (
            <>
              <p>
                New here?{" "}
                <button className="text-foreground underline" onClick={() => setMode("signup")}>
                  Create an account
                </button>
              </p>
              <p>
                <button className="underline" onClick={() => setMode("reset")}>
                  Forgot your password?
                </button>
              </p>
            </>
          )}
          {mode === "signup" && (
            <p>
              Already have an account?{" "}
              <button className="text-foreground underline" onClick={() => setMode("login")}>
                Sign in
              </button>
            </p>
          )}
          {mode === "reset" && (
            <p>
              <button className="underline" onClick={() => setMode("login")}>
                Back to sign in
              </button>
            </p>
          )}
          <p>
            <Link to="/" className="underline">Back to home</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
