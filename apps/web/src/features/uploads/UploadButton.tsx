import { Upload } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { useUploadPicker } from "./UploadProvider";

/**
 * Opens the system file picker (several files at once). On a phone the picker offers the camera,
 * the photo library and Files: nothing custom, just the right `accept` (see accept.ts).
 */
export function UploadButton({
  nodeId,
  target,
  children = "Upload",
  variant = "secondary",
  className,
  label = "Upload files",
}: {
  nodeId: string | null;
  /** Where the files are going, in words, for the progress list. */
  target: string;
  children?: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
  /** The accessible name, for when the text is hidden on small screens. */
  label?: string;
}) {
  const pick = useUploadPicker();
  return (
    <Button
      variant={variant}
      className={className}
      aria-label={label}
      onClick={() => pick({ nodeId, label: target })}
    >
      <Upload size={16} aria-hidden />
      {children}
    </Button>
  );
}
