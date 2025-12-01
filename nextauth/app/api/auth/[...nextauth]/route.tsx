import NextAuth from "next-auth";
import { NEXT_AUTH } from "@/app/lib/auth";

const handler = NextAuth(NEXT_AUTH);

export { handler as GET, handler as POST };
