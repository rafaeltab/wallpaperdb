import { type ApiPageProps, createAPIPage } from "fumadocs-openapi/ui";
import { ingestorOpenApi, mediaOpenApi } from "@/lib/openapi";
import client from "./api-page.client";

const MediaApiPage = createAPIPage(mediaOpenApi, {
    client,
});

const IngestorApiPage = createAPIPage(ingestorOpenApi, {
    client,
});

export const APIPage = (props: ApiPageProps) => {
    if (props.document.toString().includes("media")) return MediaApiPage(props);
    return IngestorApiPage(props);
};
