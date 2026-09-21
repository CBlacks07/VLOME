import Spa from "../Spa";
import SeoLinks from "../SeoLinks";
import { routeMetadata } from "../seo";

export const metadata = routeMetadata("classements");

export default function Page() {
  return (
    <>
      <Spa initialPage="classements" />
      <SeoLinks />
    </>
  );
}
