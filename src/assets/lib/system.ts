import { client } from "@/assets/lib/request";
import type { HealthResponse } from "@/types/system";

export const getHealth = () => client.get<HealthResponse>("/health");
