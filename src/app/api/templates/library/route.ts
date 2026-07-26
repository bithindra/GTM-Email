import { NextResponse } from "next/server";
import { TEMPLATE_LIBRARY } from "@/lib/templateLibrary";

// The starter mail presets. The UI reads these to offer "add another mail from the
// library" — restoring a deleted preset, or using one as the base for a new category.
// Presets are content only; saving one creates a normal, fully editable template.
export async function GET() {
  return NextResponse.json({ library: TEMPLATE_LIBRARY });
}
