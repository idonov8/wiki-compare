import SignIn from "@/components/SignIn";

export const metadata = {
  title: "Log in — wiki-compare",
  description: "A link in your inbox, and five articles to open for everyone.",
};

export default function Page() {
  return <SignIn heading="Curious?" blurb="Log in to process articles for everyone to read and learn from." />;
}
