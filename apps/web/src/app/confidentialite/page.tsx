import Spa from "../Spa";
import SeoLinks from "../SeoLinks";
import { routeMetadata } from "../seo";

export const metadata = routeMetadata("confidentialite");

export default function Page() {
  return (
    <>
      <Spa initialPage="confidentialite" />
      <SeoLinks />
    </>
  );
}
