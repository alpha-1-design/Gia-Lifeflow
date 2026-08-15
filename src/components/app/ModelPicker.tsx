import { Check, Eye, X } from "lucide-react";
import { motion } from "framer-motion";
import { useState } from "react";

import { AI_PROVIDERS, MODEL_CATALOG, providerIdFor, type AiConfig, type AiProviderId } from "@/lib/ai";

interface ModelPickerProps {
  config: AiConfig;
  onClose: () => void;
  onSave: (next: AiConfig) => void;
}

/** Quick model switcher — pick a provider, then a model, done. */
export default function ModelPicker({ config, onClose, onSave }: ModelPickerProps) {
  const [provider, setProvider] = useState<AiProviderId>(providerIdFor(config.baseUrl));
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [model, setModel] = useState(config.model);

  const models = MODEL_CATALOG[provider] ?? [];
  const providerMeta = AI_PROVIDERS.find((p) => p.id === provider)!;

  const chooseModel = (id: string) => {
    onSave({ ...config, baseUrl: providerMeta.baseUrl, model: id });
    onClose();
  };

  const saveCustom = () => {
    onSave({ ...config, baseUrl: baseUrl.trim(), model: model.trim() });
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="w-full max-w-md rounded-2xl border bg-card p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Switch model</p>
            <p className="text-xs text-muted-foreground">Provider first, then the model.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Providers */}
        <div className="mb-4 flex flex-wrap gap-1.5">
          {AI_PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setProvider(p.id)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                provider === p.id ? "bg-foreground text-background" : "border hover:bg-accent"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {provider === "custom" ? (
          <div className="space-y-2">
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="Base URL — https://api.openai.com/v1"
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40"
            />
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Model id — gpt-4o-mini"
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:border-foreground/40"
            />
            <button
              type="button"
              onClick={saveCustom}
              disabled={!baseUrl.trim() || !model.trim()}
              className="w-full rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Use this endpoint
            </button>
          </div>
        ) : (
          <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {models.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => chooseModel(m.id)}
                className={`flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${
                  config.model === m.id && provider === providerIdFor(config.baseUrl) ? "border-foreground/50" : ""
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{m.label}</span>
                {m.vision && (
                  <span className="inline-flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    <Eye className="h-3 w-3" /> vision
                  </span>
                )}
                {config.model === m.id && provider === providerIdFor(config.baseUrl) && (
                  <Check className="h-4 w-4 shrink-0" />
                )}
              </button>
            ))}
            <p className="pt-1 text-[11px] text-muted-foreground">
              {providerMeta.hint}
            </p>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
