import { profileUnavailableMessage, type CapabilitiesView } from "@/lib/api/capabilities";
import type { PromptOption } from "@/components/primitives/PromptBar";
import type { Profile } from "@/lib/api/types";

const PROFILE_COPY: Record<Profile, { name: string; description: string }> = {
  fast: { name: "Fast", description: "Faster everyday analysis" },
  deep: { name: "Deep", description: "More context for heavier research" },
};

export function profileOptions(view: CapabilitiesView): PromptOption[] {
  return (["fast", "deep"] as const).map((profile) => {
    const availability = view.profiles[profile];
    return {
      key: profile,
      name: PROFILE_COPY[profile].name,
      description: PROFILE_COPY[profile].description,
      disabled: !availability.available,
      disabledReason: availability.available
        ? undefined
        : availability.reason ?? profileUnavailableMessage(availability) ?? undefined,
    };
  });
}
