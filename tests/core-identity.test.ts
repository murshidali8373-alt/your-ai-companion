import { describe, expect, it } from "vitest";
import {
  AI_BUDDY_CORE_IDENTITY,
  AI_BUDDY_SPECIALIST_ROSTER,
  AI_BUDDY_CAPABILITIES,
  buildCoreIdentityPrompt,
} from "../src/lib/ai/core-identity";
import { getBuddyPreset, buildBuddySystemPrompt } from "../src/lib/ai/buddy-personas";
import { buildSystemPrompt } from "../src/lib/ai/prompt";

describe("AI Buddy Core Identity Prompt Architecture", () => {
  it("exports the 15 canonical specialist Buddies in AI_BUDDY_SPECIALIST_ROSTER", () => {
    expect(AI_BUDDY_SPECIALIST_ROSTER.length).toBe(15);
    expect(AI_BUDDY_SPECIALIST_ROSTER).toContain("Friendly Buddy");
    expect(AI_BUDDY_SPECIALIST_ROSTER).toContain("Detective Buddy");
    expect(AI_BUDDY_SPECIALIST_ROSTER).toContain("Data Buddy");
    expect(AI_BUDDY_SPECIALIST_ROSTER).toContain("CA Buddy");
    expect(AI_BUDDY_SPECIALIST_ROSTER).toContain("Legal Buddy");
  });

  it("buildCoreIdentityPrompt establishes AI Buddy as the primary identity", () => {
    const prompt = buildCoreIdentityPrompt({
      specialistName: "Detective Buddy",
      specialistInstructions: "Uncover hidden clauses and evaluate facts critically.",
      providerDisclosure: "Google Gemini",
    });

    // Contains AI Buddy core identity
    expect(prompt).toContain("You are AI Buddy");
    expect(prompt).toContain("APPLICATION IDENTITY");
    expect(prompt).toContain(
      "Your identity belongs to the application, not to the language model or provider",
    );

    // Preserves specialist role inside ACTIVE SPECIALIST ROLE
    expect(prompt).toContain("ACTIVE SPECIALIST ROLE\nYou are Detective Buddy");
    expect(prompt).toContain("Uncover hidden clauses and evaluate facts critically.");

    // Mentions provider configuration without claiming Gemini is the identity
    expect(prompt).toContain("VERIFIED PROVIDER CONFIGURATION");
    expect(prompt).toContain("Google Gemini");
    expect(prompt).not.toContain("You are Gemini");
    expect(prompt).not.toContain("You are Google Gemini");
  });

  it("buildBuddySystemPrompt wraps specialist personas with core identity", () => {
    const dataBuddy = getBuddyPreset("data");
    const prompt = buildBuddySystemPrompt(dataBuddy, { providerDisclosure: "Google Gemini" });

    expect(prompt).toContain("You are AI Buddy");
    expect(prompt).toContain("Data Buddy");
    expect(prompt).toContain("ACTIVE SPECIALIST ROLE");
    expect(prompt).toContain(dataBuddy.personality);
    expect(prompt).toContain("Google Gemini");
  });

  it("buildSystemPrompt integrates core identity for DOM and browser extension flows", () => {
    const prompt = buildSystemPrompt({
      persona: {
        name: "Detective Buddy",
        personality: "Inquisitive, sharp, deductive",
        teachingStyle: "investigative",
        humorLevel: 2,
        seriousness: 5,
        language: "english",
        expertise: ["Investigation", "Verification"],
        systemPrompt: "Investigate anomalies and verify user claims against data.",
      },
      permission: "observe",
      memories: [{ key: "preferred_name", value: "Murshid" }],
      privacyMode: false,
      providerDisclosure: "Google Gemini",
    });

    expect(prompt).toContain("You are AI Buddy");
    expect(prompt).toContain("ACTIVE SPECIALIST ROLE\nYou are Detective Buddy");
    expect(prompt).toContain("Investigate anomalies");
    expect(prompt).toContain("HOW YOU WORK");
    expect(prompt).toContain("OUTPUT FORMAT");
    expect(prompt).toContain("WHAT YOU REMEMBER ABOUT THIS USER");
    expect(prompt).toContain("preferred_name: Murshid");
    expect(prompt).toContain("Google Gemini");
  });

  it("handles missing provider disclosure honestly without guessing", () => {
    const prompt = buildCoreIdentityPrompt({
      specialistName: "Friendly Buddy",
      specialistInstructions: "Be cheerful and helpful.",
    });

    expect(prompt).toContain(
      "No provider configuration was supplied to this prompt. Do not guess the provider used for this response.",
    );
  });
});
