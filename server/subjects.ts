import { definePluginSubjects, subject } from "@barista/types";
import manifest from "../manifest.json";

export const subjects = definePluginSubjects(manifest, {
  changed: subject<void>(),
});
