import type { Metadata } from "next";
import { FutureExperience } from "@/components/future/FutureExperience";

export const metadata: Metadata = {
  title: "The Future of App Discovery",
  description:
    "nebulous.world's ranking, staking, and revenue-sharing engine, explained through a WebGL2-shader, scroll-driven single page — built on the current edge of the web platform.",
};

export default function FuturePage() {
  return <FutureExperience />;
}
