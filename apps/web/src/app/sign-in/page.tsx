"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ProductMark } from "@/components/product-mark";
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
    <main className="grid min-h-screen lg:grid-cols-[0.92fr_1.08fr]">
      <section className="relative hidden overflow-hidden border-r border-[#242d40] bg-[#0a0d14] p-10 lg:flex lg:flex-col">
        <Link href="/" className="inline-flex">
          <ProductMark />
        </Link>
        <div className="my-auto max-w-xl py-16">
          <p className="am-kicker">Accès sécurisé</p>
          <h1 className="mt-5 text-5xl font-semibold leading-[1.02] tracking-[-0.05em]">
            Reprenez le contrôle de votre parc web.
          </h1>
          <p className="mt-6 text-lg leading-8 text-[#8995aa]">
            Une session suffit pour retrouver vos sites, les scans en cours, les
            régressions et les rapports à partager.
          </p>
          <div className="mt-10 divide-y divide-[#242d40] border-y border-[#242d40]">
            {[
              ["01", "Sites", "Vue multi-client et statut immédiat"],
              ["02", "Scans", "Suivi live jusqu’au rapport"],
              ["03", "Remédiation", "Chaque finding mène à une action"],
            ].map(([index, title, detail]) => (
              <div
                key={title}
                className="grid grid-cols-[40px_110px_1fr] gap-3 py-4 text-sm"
              >
                <span className="font-mono text-[#56627a]">{index}</span>
                <span className="font-semibold">{title}</span>
                <span className="text-[#7f8a9f]">{detail}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#58647a]">
          OTP · aucune authentification par mot de passe
        </p>
      </section>

      <section className="grid place-items-center px-6 py-10">
        <div className="w-full max-w-md">
          <Link href="/" className="mb-12 inline-flex lg:hidden">
            <ProductMark />
          </Link>
          <p className="am-kicker">Session agence</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.035em]">
            {step === "email"
              ? "Connexion ou création de compte"
              : "Vérifiez votre e-mail"}
          </h2>
          <p className="mt-3 leading-7 text-[#8793a8]">
            {step === "email"
              ? "Saisissez votre adresse e-mail. WebProbe utilise une connexion sans mot de passe : un code temporaire à usage unique vous est envoyé à chaque connexion."
              : "Entrez le code à 6 chiffres reçu par e-mail."}
          </p>

          {step === "email" ? (
            <div className="mt-5 border-l-2 border-[#6d7cff] bg-[#0f1421] px-4 py-3 text-sm leading-6 text-[#aab5c9]">
              <strong className="font-semibold text-white">
                Aucun mot de passe à créer ou à mémoriser.
              </strong>{" "}
              L’accès au compte dépend de votre boîte e-mail et du code OTP
              reçu. Pour renforcer cet accès, activez la MFA sur la messagerie
              utilisée. Lors d’une première connexion, vous choisirez ensuite
              votre nom affiché.
            </div>
          ) : null}

          {step === "email" ? (
            <form className="mt-8 space-y-5" onSubmit={sendOtp}>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[#b8c1d2]">
                  Adresse e-mail
                </span>
                <input
                  autoComplete="email"
                  autoFocus
                  required
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="am-field"
                  placeholder="vous@agence.fr"
                />
              </label>
              <button
                disabled={pending || !normalizedEmail}
                className="am-button-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? "Envoi…" : "Recevoir mon code"}
              </button>
            </form>
          ) : (
            <form className="mt-8 space-y-5" onSubmit={verifyOtp}>
              <div className="am-panel-soft px-4 py-3 text-sm text-[#9ba7bc]">
                Code envoyé à <strong className="text-white">{email}</strong>
              </div>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[#b8c1d2]">
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
                  className="am-field text-center font-mono text-2xl tracking-[0.32em]"
                  placeholder="000000"
                />
              </label>
              <button
                disabled={pending || otp.length !== 6}
                className="am-button-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
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
                className="w-full px-4 py-2 text-sm text-[#748097] transition hover:text-[#b9c3d4]"
              >
                Utiliser une autre adresse
              </button>
            </form>
          )}

          {message ? (
            <p
              aria-live="polite"
              className="mt-5 border-l-2 border-[#6d7cff] bg-[#0f1421] px-4 py-3 text-sm text-[#aab5c9]"
            >
              {message}
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
