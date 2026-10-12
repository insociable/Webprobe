"use client";

import { useState } from "react";
import Image from "next/image";

const BITCOIN_ADDRESS = "bc1q8uhgy9cr7m2mftlhtarm8pn8777969dk8vds50";

export function BitcoinDonation() {
  const [copied, setCopied] = useState(false);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(BITCOIN_ADDRESS);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section
      aria-labelledby="support-webprobe-title"
      className="mx-auto w-[min(1240px,calc(100%-32px))] border-t border-[#242d40] py-12"
    >
      <div className="am-panel grid items-center gap-6 p-6 md:grid-cols-[1fr_auto] md:p-8">
        <div className="min-w-0">
          <p className="am-kicker">Projet open source</p>
          <h2
            id="support-webprobe-title"
            className="mt-3 text-2xl font-semibold"
          >
            Soutenir WebProbe
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--muted-strong)]">
            WebProbe est développé et maintenu pour rendre l’audit web plus
            accessible. Si le projet vous est utile, vous pouvez contribuer
            librement en Bitcoin à ses frais d’hébergement, à sa maintenance et
            à ses futures évolutions.
          </p>
          <p className="mt-5 text-xs font-medium text-[var(--muted-strong)]">
            Adresse Bitcoin (réseau BTC)
          </p>
          <p
            className="mt-2 break-all rounded-md border border-[var(--line-strong)] px-3 py-3 font-mono text-sm select-all"
            aria-label="Adresse de réception Bitcoin"
          >
            {BITCOIN_ADDRESS}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="am-button-secondary"
              onClick={copyAddress}
            >
              {copied ? "Adresse copiée" : "Copier l’adresse"}
            </button>
            <a
              className="text-sm text-[var(--accent-strong)] underline underline-offset-4"
              href={`bitcoin:${BITCOIN_ADDRESS}`}
            >
              Ouvrir mon portefeuille
            </a>
          </div>
          <p className="mt-4 text-xs text-[var(--muted-strong)]">
            Don facultatif, sans contrepartie. Envoyez uniquement du BTC sur le
            réseau Bitcoin.
          </p>
        </div>
        <div className="flex flex-col items-center gap-2">
          <Image
            src="/bitcoin-donation.png"
            width="156"
            height="156"
            alt="QR code de l’adresse Bitcoin pour soutenir WebProbe"
            className="rounded-md bg-white p-2"
          />
          <span className="text-xs text-[var(--muted-strong)]">
            Scanner pour contribuer
          </span>
        </div>
      </div>
    </section>
  );
}
