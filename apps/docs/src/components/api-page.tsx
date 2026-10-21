import { type ApiPageProps, createAPIPage } from "fumadocs-openapi/ui";
import { assetOpenApi, ingestorOpenApi } from "@/lib/openapi";
import client from "./api-page.client";

const AssetApiPage = createAPIPage(assetOpenApi, {
  client,
});

const IngestorApiPage = createAPIPage(ingestorOpenApi, {
  client,
});

export const APIPage = (props: ApiPageProps) => {
  if (props.document.toString().includes("asset")) return AssetApiPage(props);
  return IngestorApiPage(props);
};
