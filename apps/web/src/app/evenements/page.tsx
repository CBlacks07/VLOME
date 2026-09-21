import Spa from "../Spa";
import SeoLinks from "../SeoLinks";
import { routeMetadata } from "../seo";

export const metadata = routeMetadata("evenements");

export default function Page() {
  return (
    <>
      <Spa initialPage="evenements" />
      <SeoLinks />
    </>
  );
}
