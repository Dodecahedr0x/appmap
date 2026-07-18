"use client";

import { useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { apiPost, signAndSubmit } from "@/lib/txClient";

export interface CreateAppParams {
  appId: string;
  url: string;
  tags?: string[];
  name?: string;
  tagline?: string;
  description?: string;
  iconUrl?: string;
  category?: string;
  chain?: string;
}

/**
 * Builds+signs+submits the on-chain app-(+ initial tags)-creation
 * transaction, and adding a tag to an app that already exists. Unlike
 * useVoteProgram, neither of these ever has a simulation-mode branch:
 * `init_app`/`suggest_tag` never touch the vote-token mint (see
 * programs/nebulous_world/src/instructions/init_app.rs's doc comment), so
 * they run the same real on-chain way regardless of whether a vote mint is
 * configured — there is no off-chain fallback recording for app/tag
 * creation any more (see AGENTS.md).
 */
export function useCreateAppProgram() {
  const wallet = useWallet();

  const createApp = useCallback(
    async (params: CreateAppParams): Promise<string> => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first");
      const { transaction } = await apiPost<{ transaction: string }>("/api/tx/create-app", {
        ...params,
        user: wallet.publicKey.toBase58(),
      });
      return signAndSubmit(wallet, transaction);
    },
    [wallet],
  );

  const suggestTag = useCallback(
    async (appId: string, tagSlug: string): Promise<string> => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first");
      const { transaction } = await apiPost<{ transaction: string }>("/api/tx/suggest-tag", {
        appId,
        tagSlug,
        user: wallet.publicKey.toBase58(),
      });
      return signAndSubmit(wallet, transaction);
    },
    [wallet],
  );

  return { createApp, suggestTag };
}
