/**
 * Document Understanding & OCR extraction endpoint for AI Buddy Extension.
 * Supports uploaded document images (PNG, JPEG, WEBP) and PDFs (Aadhaar, PAN,
 * invoices, shipping labels, etc.). Uses server-side @google/genai when available
 * and falls back safely to deterministic local text parsing without inventing fields.
 */

import { createFileRoute } from "@tanstack/react-router";
import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";

import { getGeminiKey } from "@/lib/ai/provider-keys.server";
import {
  parseDocumentTextLocally,
  sanitizeExtractedFields,
  type DocumentType,
} from "@/shared/document-extractor";

const bodySchema = z.object({
  fileName: z.string().min(1).max(260),
  mimeType: z.string().min(1).max(120),
  base64Data: z.string().max(12_000_000).optional(),
  textContent: z.string().max(100_000).optional(),
  userApiKey: z.string().max(200).optional(),
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const ALLOWED_DOC_TYPES = new Set<DocumentType>([
  "aadhaar",
  "pan",
  "invoice",
  "shipping_label",
  "id_card",
  "form",
  "other",
]);

export const Route = createFileRoute("/api/public/extension/extract-document")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed: z.infer<typeof bodySchema>;
        try {
          parsed = bodySchema.parse(await request.json());
        } catch {
          return json({ ok: false, error: "bad_request", message: "Invalid document payload." }, 400);
        }

        const apiKey = parsed.userApiKey?.trim() || getGeminiKey();
        const isBinaryDoc =
          Boolean(parsed.base64Data) &&
          /^(image\/(png|jpeg|jpg|webp|gif)|application\/pdf)$/i.test(parsed.mimeType);

        if (apiKey && isBinaryDoc && parsed.base64Data) {
          try {
            const ai = new GoogleGenAI({
              apiKey,
              httpOptions: {
                headers: {
                  "User-Agent": "aistudio-build",
                },
              },
            });

            const cleanBase64 = parsed.base64Data.replace(/^data:[^;]+;base64,/, "");
            const trialModels = ["gemini-4-hydrogen", "gemini-3.8-flash", "gemini-3.1-flash-lite"];
            let lastErr: unknown;

            for (const model of trialModels) {
              try {
                const response = await ai.models.generateContent({
                  model,
                  contents: {
                    parts: [
                      {
                        inlineData: {
                          mimeType:
                            parsed.mimeType === "image/jpg" ? "image/jpeg" : parsed.mimeType,
                          data: cleanBase64,
                        },
                      },
                      {
                        text: [
                          `Carefully read this uploaded document (${parsed.fileName}) and extract structured information into JSON.`,
                          "CRITICAL RULES:",
                          "1. Preserve original formatting (such as exact DD/MM/YYYY date of birth, exact Aadhaar 12-digit spacing, PAN letters/digits, full postal address, pincode).",
                          "2. NEVER invent, guess, or fabricate any field that is not clearly visible in the document. Leave missing fields omitted or empty string.",
                          "3. If a field is blurry, partially cut off, or has conflicting values, list its field name inside ambiguousFields.",
                        ].join("\n"),
                      },
                    ],
                  },
                  config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                      type: Type.OBJECT,
                      properties: {
                        documentType: {
                          type: Type.STRING,
                          description:
                            "One of: aadhaar, pan, invoice, shipping_label, id_card, form, other",
                        },
                        confidence: {
                          type: Type.STRING,
                          description: "One of: high, medium, low",
                        },
                        fields: {
                          type: Type.OBJECT,
                          properties: {
                            name: { type: Type.STRING },
                            fatherName: { type: Type.STRING },
                            dob: { type: Type.STRING },
                            gender: { type: Type.STRING },
                            phone: { type: Type.STRING },
                            email: { type: Type.STRING },
                            address: { type: Type.STRING },
                            city: { type: Type.STRING },
                            state: { type: Type.STRING },
                            pincode: { type: Type.STRING },
                            aadhaarNumber: { type: Type.STRING },
                            panNumber: { type: Type.STRING },
                            gstin: { type: Type.STRING },
                            invoiceNumber: { type: Type.STRING },
                            orderId: { type: Type.STRING },
                            trackingNumber: { type: Type.STRING },
                            company: { type: Type.STRING },
                            amount: { type: Type.STRING },
                            date: { type: Type.STRING },
                          },
                        },
                        ambiguousFields: {
                          type: Type.ARRAY,
                          items: { type: Type.STRING },
                        },
                        notes: { type: Type.STRING },
                      },
                    },
                  },
                });

                const rawText = (response.text ?? "").trim();
                if (rawText) {
                  const data = JSON.parse(rawText) as {
                    documentType?: string;
                    confidence?: string;
                    fields?: Record<string, unknown>;
                    ambiguousFields?: unknown[];
                    notes?: string;
                  };
                  const docType = ALLOWED_DOC_TYPES.has(data.documentType as DocumentType)
                    ? (data.documentType as DocumentType)
                    : "other";
                  const cleanFields = sanitizeExtractedFields(data.fields);
                  const ambiguous = Array.isArray(data.ambiguousFields)
                    ? data.ambiguousFields.filter((x): x is string => typeof x === "string")
                    : [];

                  return json({
                    ok: Object.keys(cleanFields).length > 0 || ambiguous.length > 0,
                    documentType: docType,
                    fileName: parsed.fileName,
                    confidence:
                      data.confidence === "high" ||
                      data.confidence === "medium" ||
                      data.confidence === "low"
                        ? data.confidence
                        : Object.keys(cleanFields).length > 0
                          ? "medium"
                          : "low",
                    fields: cleanFields,
                    ambiguousFields: ambiguous,
                    notes: typeof data.notes === "string" ? data.notes : undefined,
                    provider: `gemini:${model}`,
                  });
                }
              } catch (err) {
                lastErr = err;
              }
            }

            if (lastErr) {
              console.warn("[extract-document] Gemini fallback triggered");
            }
          } catch {
            // Fall through safely to text parser fallback below
          }
        }

        // Local OCR text parser fallback (works offline/without server API key on text/PDF text layers)
        if (parsed.textContent?.trim()) {
          const localResult = parseDocumentTextLocally(parsed.textContent, parsed.fileName);
          return json(localResult);
        }

        return json({
          ok: false,
          documentType: "other",
          fileName: parsed.fileName,
          confidence: "low",
          fields: {},
          ambiguousFields: [],
          needsVisionKey: !apiKey && isBinaryDoc,
          notes: !apiKey && isBinaryDoc
            ? "Document image uploaded, but AI Vision key is not configured to OCR image pixels. Add GEMINI_API_KEY on the server or in Settings → AI Model Hub."
            : "Could not extract readable fields from this document.",
        });
      },
    },
  },
});
