declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  [key: string]: any;
};

declare module "https://deno.land/std@0.168.0/http/server.ts" {
  export function serve(handler: (req: Request) => Promise<Response> | Response): void;
}

declare module "https://esm.sh/@supabase/supabase-js@2.45.4" {
  export * from "@supabase/supabase-js";
}

declare module "https://*" {
  const content: any;
  export default content;
  export * from "@supabase/supabase-js";
}
