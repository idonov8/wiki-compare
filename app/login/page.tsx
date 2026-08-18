import SignIn from "@/components/SignIn";

export const metadata = {
  title: "Log in to Wiki Compare",
  description: "Log in for free to compare full articles",
};

export default function Page() {
  return <SignIn heading="Curious?" blurb="Log in to process articles for everyone to read and learn from." />;
}
