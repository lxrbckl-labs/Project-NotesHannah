import { SlidersHorizontal, Square, Volume2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, IconButton } from "../../../components/ui/button";
import { Popover } from "../../../components/ui/popover";
import { SegmentedControl } from "../../../components/ui/segmented";
import { Switch } from "../../../components/ui/switch";

/**
 * Focus aids for answering questions: things she can switch on to make a question easier to read and
 * to keep her attention on it. Each is off until she turns it on, and each is remembered in this
 * browser. Nothing here changes what is asked or how an answer is marked.
 */
export interface FocusAids {
  /** The question and its answers, drawn larger. */
  text: "normal" | "large" | "larger";
  /** More room between letters, words and lines. */
  spacing: boolean;
  /** Hides the question count and the progress bar, so only the question is on screen. */
  calm: boolean;
  /** A band that follows the pointer or finger, dimming the lines above and below. */
  ruler: boolean;
}

const DEFAULTS: FocusAids = { text: "normal", spacing: false, calm: false, ruler: false };
const KEY = "notes-focus-aids";

function load(): FocusAids {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!raw || typeof raw !== "object") return DEFAULTS;
    const r = raw as Partial<Record<keyof FocusAids, unknown>>;
    return {
      text: r.text === "large" || r.text === "larger" ? r.text : "normal",
      spacing: r.spacing === true,
      calm: r.calm === true,
      ruler: r.ruler === true,
    };
  } catch {
    return DEFAULTS;
  }
}

export function useFocusAids() {
  const [aids, setAids] = useState<FocusAids>(load);
  const change = useCallback((patch: Partial<FocusAids>) => {
    setAids((old) => {
      const next = { ...old, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Not remembered, but it still applies now.
      }
      return next;
    });
  }, []);
  return [aids, change] as const;
}

/** Light markdown and blanks, turned into words a voice can read. */
export function speakable(text: string): string {
  return text
    .replace(/\{\{\s*\d+\s*\}\}/g, " blank ")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Reads a question aloud with the device's own voice, where the browser has one. */
export function useReadAloud(text: string) {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [speaking, setSpeaking] = useState(false);
  // A new question, or leaving the screen, stops the voice.
  // biome-ignore lint/correctness/useExhaustiveDependencies: stop whenever the text changes
  useEffect(() => {
    return () => {
      if (supported) window.speechSynthesis.cancel();
      setSpeaking(false);
    };
  }, [text, supported]);
  const toggle = useCallback(() => {
    if (!supported) return;
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const words = new SpeechSynthesisUtterance(speakable(text));
    words.rate = 0.95;
    words.onend = () => setSpeaking(false);
    words.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(words);
  }, [supported, text]);
  return { supported, speaking, toggle };
}

/** The button in the player's bar and the panel it opens. */
export function FocusAidsButton({
  aids,
  onChange,
  readAloud,
  className,
}: {
  aids: FocusAids;
  onChange: (patch: Partial<FocusAids>) => void;
  readAloud: { supported: boolean; speaking: boolean; toggle: () => void };
  className?: string;
}) {
  const on = aids.text !== "normal" || aids.spacing || aids.calm || aids.ruler;
  return (
    <Popover
      label="Focus aids"
      title="Focus aids"
      align="end"
      trigger={
        <IconButton
          label="Focus aids"
          data-testid="focus-aids"
          pressed={on}
          {...(className ? { className } : {})}
        >
          <SlidersHorizontal size={18} />
        </IconButton>
      }
    >
      <div className="grid w-72 max-w-full gap-4">
        <div className="grid gap-1.5">
          <p className="text-ui font-medium">Text size</p>
          <SegmentedControl
            label="Text size"
            value={aids.text}
            onValueChange={(text) => onChange({ text })}
            fill
            items={[
              { value: "normal", label: "Normal" },
              { value: "large", label: "Large" },
              { value: "larger", label: "Larger" },
            ]}
          />
        </div>
        <Switch
          label="Extra spacing"
          description="More room between letters, words and lines."
          checked={aids.spacing}
          onCheckedChange={(spacing) => onChange({ spacing })}
        />
        <Switch
          label="Reading ruler"
          description="A band follows your pointer or finger and dims the rest."
          checked={aids.ruler}
          onCheckedChange={(ruler) => onChange({ ruler })}
        />
        <Switch
          label="Just the question"
          description="Hides the question count and the progress bar."
          checked={aids.calm}
          onCheckedChange={(calm) => onChange({ calm })}
        />
        {readAloud.supported ? (
          <Button onClick={readAloud.toggle} data-testid="read-aloud">
            {readAloud.speaking ? (
              <Square size={16} aria-hidden />
            ) : (
              <Volume2 size={16} aria-hidden />
            )}
            {readAloud.speaking ? "Stop reading" : "Read the question aloud"}
          </Button>
        ) : null}
        <p className="text-caption text-text-muted">
          These stay on for every session on this device. There is no timer on screen, and Pause
          stops the clock.
        </p>
      </div>
    </Popover>
  );
}
