"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

type Step = "email" | "otp";

export default function SignInPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const normalizedEmail = email.trim().toLowerCase();

  async function sendOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    const { error } = await authClient.emailOtp.sendVerificationOtp({
      email: normalizedEmail,
      type: "sign-in",
    });
    setPending(false);

    if (error) {
      setMessage("Impossible d’envoyer le code pour le moment.");
      return;
    }

    setEmail(normalizedEmail);
    setStep("otp");
    setMessage("Un code à 6 chiffres vient de vous être envoyé.");
  }

  async function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    const { error } = await authClient.signIn.emailOtp({
      email: normalizedEmail,
      otp: otp.trim(),
    });

    setPending(false);

    if (error) {
      setMessage("Code invalide ou expiré.");
      return;
    }

    router.replace("/dashboard");
    router.refresh();
  }
  return (
    <main className="mx-auto grid min-h-screen max-w-6xl place-items-center px-6 py-12">
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-7 shadow-2xl shadow-black/20">
        <div className="mb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-3 text-sm text-white/55 transition hover:text-white"
          >
            <span className="grid size-9 place-items-center rounded-lg bg-emerald-300 font-black text-emerald-950">
              A
            </span>
            Agency Monitor
          </Link>
          <h1 className="mt-8 text-3xl font-semibold tracking-tight">
            Connexion au pilote
          </h1>
          <p className="mt-3 leading-7 text-white/50">
            Aucun mot de passe. Nous vous envoyons un code temporaire par
            e-mail.
          </p>
        </div>

        {step === "email" ? (
          <form className="space-y-5" onSubmit={sendOtp}>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-white/70">
                Adresse e-mail
              </span>
              <input
                autoComplete="email"
                autoFocus
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 outline-none transition focus:border-emerald-300/60"
                placeholder="vous@agence.fr"
              />
            </label>
            <button
              disabled={pending || !normalizedEmail}
              className="w-full rounded-xl bg-emerald-300 px-4 py-3 font-semibold text-emerald-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Envoi…" : "Recevoir mon code"}
            </button>
          </form>
        ) : (
          <form className="space-y-5" onSubmit={verifyOtp}>
            <div className="rounded-xl border border-emerald-300/15 bg-emerald-300/[0.05] px-4 py-3 text-sm text-white/60">
              Code envoyé à <strong className="text-white/85">{email}</strong>
            </div>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-white/70">
                Code à 6 chiffres
              </span>
              <input
                autoComplete="one-time-code"
                autoFocus
                inputMode="numeric"
                maxLength={6}
                minLength={6}
                pattern="[0-9]{6}"
                required
                value={otp}
                onChange={(event) =>
                  setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-center font-mono text-2xl tracking-[0.3em] outline-none transition focus:border-emerald-300/60"
                placeholder="000000"
              />
            </label>
            <button
              disabled={pending || otp.length !== 6}
              className="w-full rounded-xl bg-emerald-300 px-4 py-3 font-semibold text-emerald-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Vérification…" : "Se connecter"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setOtp("");
                setMessage(null);
                setStep("email");
              }}
              className="w-full px-4 py-2 text-sm text-white/45 transition hover:text-white/70"
            >
              Utiliser une autre adresse
            </button>
          </form>
        )}

        {message ? (
          <p
            aria-live="polite"
            className="mt-5 rounded-xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white/60"
          >
            {message}
          </p>
        ) : null}
      </section>
    </main>
  );
}
