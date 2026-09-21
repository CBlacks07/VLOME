import Spa from "../Spa";
import SeoLinks from "../SeoLinks";
import { routeMetadata } from "../seo";

export const metadata = routeMetadata("mentions-legales");

export default function Page() {
  return (
    <>
      <Spa initialPage="mentions-legales" />
      <SeoLinks />
    </>
  );
}
