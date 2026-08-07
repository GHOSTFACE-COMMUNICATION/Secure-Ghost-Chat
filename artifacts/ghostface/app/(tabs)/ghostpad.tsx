import React from "react";
import { TabScreenWrapper } from "@/components/TabScreenWrapper";
import GhostpadScreen from "@/components/GhostpadPanel";

export default function GhostpadTabScreen() {
  return (
    <TabScreenWrapper>
      <GhostpadScreen embedded />
    </TabScreenWrapper>
  );
}
