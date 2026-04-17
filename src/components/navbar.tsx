// Copyright Amazon.com, Inc. or its affiliates.
import { Button } from "@heroui/button";
import { Link } from "@heroui/link";
import {
  Navbar as HeroUINavbar,
  NavbarBrand,
  NavbarContent,
  NavbarItem
} from "@heroui/navbar";
import Image from "next/image";
import NextLink from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signIn, signOut, useSession } from "next-auth/react";

import {
  GithubIcon,
  LoginIcon,
  LogoutIcon,
  MenuIcon
} from "@/components/icons.tsx";
import { ThemeSwitch } from "@/components/theme-switch.tsx";
import { siteConfig } from "@/config/site.ts";
import { useAppDispatch } from "@/store/hooks.ts";
import { toggleDrawer } from "@/store/slices/navbar-slice.ts";

export const Navbar = () => {
  const dispatch = useAppDispatch();
  const { data: session } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  // List of pages that have sidebars
  const pagesWithSidebars = ["/geo-agent", "/map", "/globe", "/image"];
  const hasSidebar = pagesWithSidebars.includes(pathname);

  const handleAuthClick = async () => {
    if (session) {
      await signOut({ redirect: false });
      router.push("/"); // Redirect to home page after logout
    } else {
      await signIn();
    }
  };

  return (
    <HeroUINavbar
      className="w-full max-w-none px-0"
      classNames={{
        wrapper: "max-w-none w-full px-0",
        base: "max-w-none w-full px-0"
      }}
      position="sticky"
    >
      <NavbarContent className="w-full px-6" justify="start">
        {hasSidebar ? (
          <Button
            isIconOnly
            aria-label="Menu"
            className="mr-2"
            variant="light"
            onPress={() => dispatch(toggleDrawer())}
          >
            <MenuIcon />
          </Button>
        ) : (
          <div className="w-10 h-10 mr-2" />
        )}
        <NavbarBrand as="li" className="gap-3">
          <NextLink className="flex justify-start items-center" href="/">
            <Image
              priority
              unoptimized
              alt="OversightML Logo"
              className="h-10"
              height={80}
              src="/images/logo-no-background-horizontal.png"
              style={{
                width: "auto",
                height: "40px"
              }}
              width={320}
            />
          </NextLink>
        </NavbarBrand>

        <div className="flex-grow" />

        <NavbarItem className="hidden sm:flex gap-2">
          <Link isExternal aria-label="Github" href={siteConfig.links.github}>
            <GithubIcon className="text-default-500" />
          </Link>
          <ThemeSwitch />
          <Button
            startContent={session ? <LogoutIcon /> : <LoginIcon />}
            variant="light"
            onPress={handleAuthClick}
          >
            {session ? "Logout" : "Login"}
          </Button>
        </NavbarItem>
      </NavbarContent>
    </HeroUINavbar>
  );
};
