/**
 * Public extension endpoint to fetch all available Buddies:
 * Returns the 15 specialist presets and the user's Custom Buddy.
 */

import { createFileRoute } from "@tanstack/react-router";
import { BUDDY_PRESETS } from "@/lib/ai/buddy-personas";
import { BUDDY_VISUALS } from "@/lib/buddy-visuals";
import {
  extensionJsonResponse,
  handleExtensionOptions,
} from "@/lib/extension-cors.server";
import { verifyBearer } from "@/lib/supabase-bearer.server";

export const Route = createFileRoute("/api/public/extension/buddies")({
  server: {
    handlers: {
      OPTIONS: async (ctx?: { request?: Request }) => handleExtensionOptions(ctx?.request),
      GET: async (ctx?: { request?: Request }) => {
        const request = ctx?.request;
        let auth = null;
        try {
          auth = await verifyBearer(request?.headers.get("authorization") ?? null);
        } catch {
          auth = null;
        }

        let customBuddiesList: Array<{
          id: string;
          name: string;
          tagline: string | null;
          personality: string | null;
          expertise: string[] | null;
          accent_color: string | null;
          language: string | null;
          teaching_style: string | null;
        }> = [];

        let selectedSlug = "friendly";
        let selectedCustomId: string | null = null;

        if (auth) {
          try {
            const [profileRes, customRes] = await Promise.all([
              auth.db
                .from("profiles")
                .select("selected_buddy_slug, selected_custom_buddy_id")
                .eq("id", auth.userId)
                .maybeSingle(),
              auth.db
                .from("custom_buddies")
                .select(
                  "id, name, tagline, personality, expertise, accent_color, language, teaching_style",
                )
                .eq("user_id", auth.userId)
                .order("created_at", { ascending: false }),
            ]);

            selectedSlug = profileRes.data?.selected_buddy_slug || "friendly";
            selectedCustomId = profileRes.data?.selected_custom_buddy_id || null;
            customBuddiesList = customRes.data || [];
          } catch {
            // fallback gracefully
          }
        }

        // Standard user custom buddy (either from DB or default template)
        const customBuddy = customBuddiesList[0] || {
          id: "user_custom_buddy_1",
          name: "My Custom Buddy",
          tagline: "Tailored to my workflow, forms and personal preferences",
          personality: "Attentive, proactive, tailored to my workflow",
          expertise: ["Custom Workflows", "Form Automation", "Document Review", "Specialized Guidance"],
          accent_color: "ecommerce",
          language: "hinglish",
          teaching_style: "step-by-step",
        };

        const visualMapping: Record<string, string> = {
          friendly: "general",
          developer: "developer",
          ca: "ca",
          legal: "legal",
          ecommerce: "ecommerce",
          business: "business",
          marketing: "marketing",
          research: "research",
          data: "data",
          content: "content",
          design: "design",
          operations: "business",
          professor: "professor",
          dadaji: "general",
          detective: "research",
        };

        const formattedPresets = BUDDY_PRESETS.map((p) => {
          const vKey = visualMapping[p.slug] || "general";
          const visual = BUDDY_VISUALS[vKey as keyof typeof BUDDY_VISUALS] || BUDDY_VISUALS.general;
          return {
            slug: p.slug,
            name: p.name,
            tagline: p.tagline,
            expertise: p.expertise,
            personality: p.personality,
            teachingStyle: p.teaching_style,
            defaultLanguage: p.default_language,
            accentColor: p.accent_color,
            outfit: visual.outfit,
            cue: visual.cue,
            image: `/assets/buddy-${vKey}-3d.webp`,
            isCustom: false,
          };
        });

        const formattedCustom = {
          slug: `custom:${customBuddy.id}`,
          name: customBuddy.name,
          tagline: customBuddy.tagline || "Your personal customized companion",
          expertise: customBuddy.expertise || ["Personalized Assistance"],
          personality: customBuddy.personality || "Attentive and helpful",
          teachingStyle: customBuddy.teaching_style || "practical",
          defaultLanguage: customBuddy.language || "hinglish",
          accentColor: customBuddy.accent_color || "ecommerce",
          outfit: "teal",
          cue: "parcel",
          image: "/assets/buddy-ecommerce-3d.webp",
          isCustom: true,
          id: customBuddy.id,
        };

        const all16Buddies = [...formattedPresets, formattedCustom];

        return extensionJsonResponse(request, {
          ok: true,
          buddies: all16Buddies,
          selectedBuddy: selectedCustomId ? `custom:${selectedCustomId}` : selectedSlug,
          count: all16Buddies.length,
        });
      },
    },
  },
});
