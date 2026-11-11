import React from "react";
import { Shield, ShieldCheck } from "lucide-react";

export function EnvironmentShield({ healthy, className = "", size = 20 }) {
  const Icon = healthy ? ShieldCheck : Shield;
  return (
    <Icon
      size={size}
      className={`environment-shield ${healthy ? "healthy" : ""} ${className}`}
      role="img"
      aria-label={healthy ? "Environment running normally, network checks passed" : "Cage environment"}
      strokeWidth={1.8}
    />
  );
}
