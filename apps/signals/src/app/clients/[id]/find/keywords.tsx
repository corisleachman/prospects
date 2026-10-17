"use client";
import { useState } from "react";
import { ChipInput } from "@/components/chip-input";
export function Keywords({ initial }: { initial: string[] }) {
  const [values, setValues] = useState(initial);
  return (
    <>
      <input type="hidden" name="keywords" value={values.join("\n")} />
      <ChipInput
        label="Company search keywords"
        values={values}
        onChange={setValues}
        hint="Keywords are matched by the provider. Review them before estimating."
      />
    </>
  );
}
