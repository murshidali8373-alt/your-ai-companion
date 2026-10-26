export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17";
  };
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string;
          created_at: string;
          id: string;
          metadata: Json | null;
          target: string | null;
          user_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          id?: string;
          metadata?: Json | null;
          target?: string | null;
          user_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          id?: string;
          metadata?: Json | null;
          target?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      buddies: {
        Row: {
          accent_color: string;
          created_at: string;
          default_language: string;
          expertise: string[];
          humor_level: number;
          name: string;
          personality: string;
          recommended_skills: string[];
          seriousness: number;
          slug: string;
          sort_order: number;
          system_prompt: string;
          tagline: string;
          teaching_style: string;
          voice: string;
        };
        Insert: {
          accent_color?: string;
          created_at?: string;
          default_language?: string;
          expertise?: string[];
          humor_level?: number;
          name: string;
          personality: string;
          recommended_skills?: string[];
          seriousness?: number;
          slug: string;
          sort_order?: number;
          system_prompt: string;
          tagline: string;
          teaching_style: string;
          voice?: string;
        };
        Update: {
          accent_color?: string;
          created_at?: string;
          default_language?: string;
          expertise?: string[];
          humor_level?: number;
          name?: string;
          personality?: string;
          recommended_skills?: string[];
          seriousness?: number;
          slug?: string;
          sort_order?: number;
          system_prompt?: string;
          tagline?: string;
          teaching_style?: string;
          voice?: string;
        };
        Relationships: [];
      };
      custom_buddies: {
        Row: {
          accent_color: string;
          allowed_tools: string[];
          created_at: string;
          expertise: string[];
          humor_level: number;
          id: string;
          language: string;
          memory_enabled: boolean;
          name: string;
          permission_level: Database["public"]["Enums"]["permission_level"];
          personality: string;
          seriousness: number;
          system_prompt: string;
          tagline: string;
          teaching_style: string;
          updated_at: string;
          user_id: string;
          voice: string;
        };
        Insert: {
          accent_color?: string;
          allowed_tools?: string[];
          created_at?: string;
          expertise?: string[];
          humor_level?: number;
          id?: string;
          language?: string;
          memory_enabled?: boolean;
          name: string;
          permission_level?: Database["public"]["Enums"]["permission_level"];
          personality?: string;
          seriousness?: number;
          system_prompt?: string;
          tagline?: string;
          teaching_style?: string;
          updated_at?: string;
          user_id: string;
          voice?: string;
        };
        Update: {
          accent_color?: string;
          allowed_tools?: string[];
          created_at?: string;
          expertise?: string[];
          humor_level?: number;
          id?: string;
          language?: string;
          memory_enabled?: boolean;
          name?: string;
          permission_level?: Database["public"]["Enums"]["permission_level"];
          personality?: string;
          seriousness?: number;
          system_prompt?: string;
          tagline?: string;
          teaching_style?: string;
          updated_at?: string;
          user_id?: string;
          voice?: string;
        };
        Relationships: [];
      };
      memories: {
        Row: {
          created_at: string;
          id: string;
          key: string;
          kind: string;
          source: string;
          updated_at: string;
          user_id: string;
          value: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          key: string;
          kind?: string;
          source?: string;
          updated_at?: string;
          user_id: string;
          value: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          key?: string;
          kind?: string;
          source?: string;
          updated_at?: string;
          user_id?: string;
          value?: string;
        };
        Relationships: [];
      };
      permission_settings: {
        Row: {
          allow_memory: boolean;
          allow_screenshots: boolean;
          blocked_domains: string[];
          confirm_high_impact: boolean;
          level: Database["public"]["Enums"]["permission_level"];
          privacy_mode: boolean;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          allow_memory?: boolean;
          allow_screenshots?: boolean;
          blocked_domains?: string[];
          confirm_high_impact?: boolean;
          level?: Database["public"]["Enums"]["permission_level"];
          privacy_mode?: boolean;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          allow_memory?: boolean;
          allow_screenshots?: boolean;
          blocked_domains?: string[];
          confirm_high_impact?: boolean;
          level?: Database["public"]["Enums"]["permission_level"];
          privacy_mode?: boolean;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string | null;
          graphics_mode: string;
          id: string;
          language: string;
          selected_buddy_slug: string | null;
          selected_custom_buddy_id: string | null;
          theme: string;
          updated_at: string;
          voice: string;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          graphics_mode?: string;
          id: string;
          language?: string;
          selected_buddy_slug?: string | null;
          selected_custom_buddy_id?: string | null;
          theme?: string;
          updated_at?: string;
          voice?: string;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          graphics_mode?: string;
          id?: string;
          language?: string;
          selected_buddy_slug?: string | null;
          selected_custom_buddy_id?: string | null;
          theme?: string;
          updated_at?: string;
          voice?: string;
        };
        Relationships: [];
      };
      subscriptions: {
        Row: {
          created_at: string;
          plan: string;
          status: string;
          trial_ends_at: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          plan?: string;
          status?: string;
          trial_ends_at?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          plan?: string;
          status?: string;
          trial_ends_at?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      task_events: {
        Row: {
          created_at: string;
          detail: string | null;
          id: string;
          payload: Json | null;
          phase: string;
          task_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          detail?: string | null;
          id?: string;
          payload?: Json | null;
          phase: string;
          task_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          detail?: string | null;
          id?: string;
          payload?: Json | null;
          phase?: string;
          task_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_events_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      tasks: {
        Row: {
          answer: string | null;
          buddy_slug: string | null;
          created_at: string;
          error: string | null;
          id: string;
          intent: string;
          latency_ms: number | null;
          model: string | null;
          page_title: string | null;
          page_url: string | null;
          provider: string | null;
          status: string;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          answer?: string | null;
          buddy_slug?: string | null;
          created_at?: string;
          error?: string | null;
          id?: string;
          intent?: string;
          latency_ms?: number | null;
          model?: string | null;
          page_title?: string | null;
          page_url?: string | null;
          provider?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          answer?: string | null;
          buddy_slug?: string | null;
          created_at?: string;
          error?: string | null;
          id?: string;
          intent?: string;
          latency_ms?: number | null;
          model?: string | null;
          page_title?: string | null;
          page_url?: string | null;
          provider?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      usage_counters: {
        Row: {
          day: string;
          id: string;
          requests: number;
          tokens: number;
          user_id: string;
        };
        Insert: {
          day?: string;
          id?: string;
          requests?: number;
          tokens?: number;
          user_id: string;
        };
        Update: {
          day?: string;
          id?: string;
          requests?: number;
          tokens?: number;
          user_id?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      bump_usage: {
        Args: { _max?: number; _tokens?: number };
        Returns: boolean;
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      write_audit: {
        Args: { _action: string; _metadata?: Json; _target?: string };
        Returns: undefined;
      };
    };
    Enums: {
      app_role: "admin" | "user";
      permission_level: "observe" | "explain" | "suggest" | "assist" | "execute";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      permission_level: ["observe", "explain", "suggest", "assist", "execute"],
    },
  },
} as const;
