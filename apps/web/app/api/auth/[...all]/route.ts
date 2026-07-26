import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@muster/auth";

export const { GET, POST } = toNextJsHandler(auth);
